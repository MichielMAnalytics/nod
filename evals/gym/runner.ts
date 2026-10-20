import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClock, type Clock, type ClockTenant } from './clock.ts';
import { HarnessError, openForward, type Endpoint } from './http.ts';
import { waitFor, type Kubectl } from './kubectl.ts';
import type { Attachment, ConfirmationHandler, TaskContext } from './context.ts';
import type { Check, Evidence, Expected, HarnessFailureEvidence, Transaction } from './evidence.ts';
import {
  connectedAccounts,
  createFakeTenant,
  existingFakeTenant,
  fakeCall,
  type ComposioState,
  type FakeService,
  type FakeTenant,
  type GoogleState,
  type MonitorEvent,
} from './fakes.ts';
import { commonChecks, dumpEvents, dumpSheet, report, type Report } from './grade.ts';
import { connectMcpApp, createOAuthRouter } from './mcp.ts';
import { startOtto, type Otto, type PendingApproval } from './otto.ts';
import { postgresName } from './parallel.ts';
import type { Task } from './task.ts';
import {
  attachTelegramToOtto,
  telegramOwnerFromTenant,
  telegramPublicWebhookUrl,
  telegramWebhookBaseUrl,
  type TelegramOwner,
} from './telegram.ts';
import {
  appNames,
  composioSlugs,
  fakeServiceName,
  hostAliases,
  mcpServices,
  privateAddresses,
  probeHosts,
  renderHostAliases,
  requiredFakes,
  worldFanout,
  worldForService,
  type World,
} from './world.ts';

export interface RunConfig {
  root: string;
  runId: string;
  namespace: string;
  fakesNamespace: string;
  research: string;
  provider: string;
  model: string;
  keyVariable: string;
  llmKey: string;
  harnessToken: string;
  image: string;
  workspaceImage: string;
  browserImage: string;
  faketimeImage: string;
  template: string;
  postgresTemplate: string;
  turnSeconds: number;
  taskUsd: number;
  keep: boolean;
  ottoPort: number;
  kubectl: Kubectl;
  ca?: string;
}

export interface TaskResult {
  task: string;
  title: string;
  run: string;
  tenant: string;
  at: string;
  passed: boolean;
  summary: string;
  counts: Report['counts'];
  checks: Check[];
  resultPath: string;
  harnessFailure?: boolean;
  regrade?: string;
}

export function replace(template: string, values: Record<string, string>) {
  let output = template;
  for (const [name, value] of Object.entries(values))
    output = output.replaceAll(`{{${name}}}`, value);
  const left = /\{\{[A-Z0-9_]+\}\}/.exec(output);
  if (left) throw new Error(`The pod template still contains ${left[0]}.`);
  return output;
}

async function serviceIP(config: RunConfig, service: FakeService) {
  return (
    await config.kubectl.run([
      '-n',
      config.fakesNamespace,
      'get',
      'svc',
      fakeServiceName(service),
      '-o',
      'jsonpath={.spec.clusterIP}',
    ])
  ).trim();
}

async function forward(
  config: RunConfig,
  session: Session,
  namespace: string,
  service: string,
  remote: number,
) {
  const endpoint = await openForward({
    kubectl: config.kubectl,
    namespace,
    target: `svc/${service}`,
    remote,
    service,
  });
  session.forwards.push(endpoint);
  return endpoint;
}

async function ensureNamespace(config: RunConfig) {
  const found = await config.kubectl
    .run(['get', 'namespace', config.namespace])
    .then(() => true)
    .catch(() => false);
  if (found) return;
  await config.kubectl.apply(
    await readFile(resolve(dirname(config.template), 'namespace.yaml'), 'utf8'),
  );
}

async function ensureCa(config: RunConfig) {
  const found = await config.kubectl
    .run(['-n', config.namespace, 'get', 'configmap', 'sim-ca-cert'])
    .then(() => true)
    .catch(() => false);
  if (!found) {
    const source = await config.kubectl.json<Record<string, any>>([
      '-n',
      config.research,
      'get',
      'configmap',
      'sim-ca-cert',
      '-o',
      'json',
    ]);
    await config.kubectl.apply(
      JSON.stringify({
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'sim-ca-cert', namespace: config.namespace },
        data: source.data,
      }),
    );
  }
  const configMap = await config.kubectl.json<Record<string, any>>([
    '-n',
    config.namespace,
    'get',
    'configmap',
    'sim-ca-cert',
    '-o',
    'json',
  ]);
  const ca = configMap.data?.['ca.crt'];
  if (typeof ca !== 'string' || !ca.trim()) throw new Error('ConfigMap sim-ca-cert has no ca.crt.');
  config.ca = ca;
}

export async function prepareCluster(config: RunConfig) {
  await ensureNamespace(config);
  await ensureCa(config);
}

function taskPod(config: RunConfig, task: Task) {
  return `otto-eval-${config.runId}-${task.id.replace(/[^a-z0-9-]/g, '-')}`
    .slice(0, 63)
    .replace(/-+$/, '');
}

function taskTenant(config: RunConfig, task: Task) {
  return `${config.runId}-${task.id}`.slice(0, 63);
}

function defaultTelegram(world: World) {
  if (world.native?.telegram) return;
  world.native = {
    ...(world.native ?? {}),
    telegram: { bot: { username: 'otto_gym_bot', first_name: 'Otto Gym' } },
  };
}

function emptyExpected(): Expected {
  return {
    currency: 'GBP',
    transactions: 0,
    openingBalance: 0,
    closingBalance: 0,
    netCashMovement: 0,
    revenue: 0,
    operatingExpenses: 0,
    netProfit: 0,
    netProfitIncludingVat: 0,
    netProfitNote: '',
    vatPaid: 0,
    drawings: 0,
    loanPrincipal: 0,
    tolerance: 1,
  };
}

export function confirmationHandler(task: Task): ConfirmationHandler {
  return (approval) =>
    !task.confirmations || task.confirmations.some((prefix) => approval.action.startsWith(prefix))
      ? 'Yes'
      : null;
}

interface Session {
  task: Task;
  pod: string;
  postgres: string;
  tenantId: string;
  world: World;
  services: FakeService[];
  addresses: Partial<Record<FakeService, string>>;
  tenants: Partial<Record<FakeService, FakeTenant>>;
  initial: Partial<Record<FakeService, Record<string, any>>>;
  forwards: Endpoint[];
  otto?: Otto;
  telegram?: TelegramOwner;
  clock?: Clock;
  threadId?: string;
  turnId?: string;
  messageId?: number;
  messageError?: string;
  timedOut: boolean;
  turnFinished: boolean;
  recorded: Record<string, unknown>;
  handler: ConfirmationHandler;
}

interface FakeCreationFailure {
  service: FakeService;
  error: unknown;
}

async function createFakeTenants(config: RunConfig, session: Session, continueOnError = false) {
  const adminEndpoints = new Map<FakeService, Endpoint>();
  const vendorEndpoints = new Map<FakeService, Endpoint>();
  for (const service of session.services) {
    const admin = await forward(
      config,
      session,
      config.fakesNamespace,
      fakeServiceName(service),
      9090,
    );
    adminEndpoints.set(service, admin);
    if (service === 'notion' || service === 'linear') {
      const vendor = await forward(
        config,
        session,
        config.fakesNamespace,
        fakeServiceName(service),
        443,
      );
      vendorEndpoints.set(service, vendor);
    }
  }
  const admin = (service: FakeService) => {
    const endpoint = adminEndpoints.get(service);
    if (!endpoint) throw new Error(`No admin endpoint for ${service}.`);
    return endpoint;
  };
  const token = randomBytes(24).toString('hex');
  const failures: FakeCreationFailure[] = [];
  const create = async (service: FakeService, world: Record<string, unknown>) => {
    try {
      session.tenants[service] = await createFakeTenant({
        service,
        admin: admin(service),
        harnessToken: config.harnessToken,
        tenant: session.tenantId,
        token,
        label: config.runId,
        world,
        ...(service === 'telegram'
          ? { webhookBaseUrl: telegramWebhookBaseUrl(config.namespace, session.pod) }
          : {}),
      });
    } catch (error) {
      if (!continueOnError) throw error;
      failures.push({ service, error });
    }
  };
  for (const { service, world } of worldFanout(
    session.world,
    session.task.apps,
    session.task.channel,
  ))
    await create(service, world as unknown as Record<string, unknown>);
  if (session.services.includes('composio')) {
    const upstream: Record<string, unknown> = {};
    for (const service of ['google', 'slack'] as const) {
      const tenant = session.tenants[service];
      if (tenant) upstream[service] = { tenant: tenant.tenant, admin_token: tenant.token };
    }
    await create('composio', { upstream });
  }
  return { token, vendorEndpoints, failures };
}

async function createFakes(config: RunConfig, session: Session) {
  const { token, vendorEndpoints } = await createFakeTenants(config, session);
  return { token, vendorEndpoints };
}

function refsIn(value: unknown, refs = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) refsIn(item, refs);
    return refs;
  }
  if (!value || typeof value !== 'object') return refs;
  const record = value as Record<string, unknown>;
  if (typeof record.ref === 'string' && record.ref) refs.add(record.ref);
  for (const item of Object.values(record)) refsIn(item, refs);
  return refs;
}

function stateRefs(value: unknown) {
  return refsIn(value);
}

function stateSummary(service: FakeService, state: Record<string, any>) {
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  switch (service) {
    case 'google':
      return `files ${count(state.files)}, spreadsheets ${count(state.spreadsheets)}, mailboxes ${count(state.mailboxes)}, calendars ${count(state.calendars)}, events ${count(state.events)}`;
    case 'slack':
      return `channels ${count(state.channels)}, DMs ${count(state.dms)}, files ${count(state.files)}`;
    case 'notion':
      return `databases ${count(state.databases)}, pages ${count(state.pages)}, comments ${count(state.comments)}`;
    case 'linear':
      return `teams ${count(state.teams)}, issues ${count(state.issues)}, projects ${count(state.projects)}`;
    case 'telegram':
      return `chats ${count(state.chats)}, bots ${count(state.bots)}`;
    case 'composio':
      return `connected accounts ${count(state.connected_accounts)}, tool calls ${count(state.tool_calls)}`;
  }
}

export interface WorldValidationCheck {
  service: FakeService;
  tenant: string;
  state?: string;
  missingRefs: string[];
  missingState: string[];
  error?: string;
}

export interface WorldValidationResult {
  task: string;
  title: string;
  passed: boolean;
  checks: WorldValidationCheck[];
}

export async function validateWorlds(
  config: RunConfig,
  tasks: Task[],
): Promise<WorldValidationResult[]> {
  const results: WorldValidationResult[] = [];
  for (const task of tasks) {
    const suffix = randomBytes(3).toString('hex');
    const tenantId = `validate-${task.id}-${suffix}`.slice(0, 63).replace(/-+$/, '');
    const services = requiredFakes(task.apps, task.channel);
    const world = task.world();
    world.now ??= new Date().toISOString();
    if (task.channel === 'telegram') defaultTelegram(world);
    const session: Session = {
      task,
      pod: tenantId,
      postgres: '',
      tenantId,
      world,
      services,
      addresses: {},
      tenants: {},
      initial: {},
      forwards: [],
      timedOut: false,
      turnFinished: false,
      recorded: {},
      handler: confirmationHandler(task),
    };
    const checks: WorldValidationCheck[] = [];
    console.log(`\n${task.id}: creating ${services.join(', ')} tenants ${tenantId}`);
    try {
      for (const service of services) {
        session.addresses[service] = await serviceIP(config, service);
        if (!session.addresses[service])
          throw new Error(`Could not resolve ${fakeServiceName(service)}.`);
      }
      const { failures } = await createFakeTenants(config, session, true);
      for (const { service, error } of failures) {
        const detail = error instanceof Error ? error.message : String(error);
        checks.push({
          service,
          tenant: tenantId,
          missingRefs: [],
          missingState: [],
          error: detail,
        });
        console.log(`  ${fakeServiceName(service)}: FAILED ${detail}`);
      }
      for (const [service, tenant] of Object.entries(session.tenants) as Array<
        [FakeService, FakeTenant]
      >) {
        try {
          const state = await tenant.state();
          const refs = await fakeCall(
            tenant.admin,
            `collect ${fakeServiceName(service)} refs`,
            'GET',
            `/_sim/v1/tenants/${encodeURIComponent(tenant.tenant)}/refs`,
            tenant.token,
          );
          const sliced = worldForService(world, service);
          const expected = refsIn(sliced.entities);
          for (const value of Object.values(sliced.native ?? {})) refsIn(value, expected);
          const known = new Set(Object.keys((refs.refs ?? {}) as Record<string, string>));
          const seen = stateRefs(state);
          const missingRefs = [...expected].filter((ref) => !known.has(ref));
          const missingState = [...expected].filter((ref) => !seen.has(ref));
          const summary = stateSummary(service, state);
          checks.push({
            service,
            tenant: tenantId,
            state: summary,
            missingRefs,
            missingState,
          });
          console.log(
            `  ${fakeServiceName(service)}: created (${summary})${missingRefs.length ? `; missing refs: ${missingRefs.join(', ')}` : ''}${missingState.length ? `; refs missing from state: ${missingState.join(', ')}` : ''}`,
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          checks.push({
            service,
            tenant: tenantId,
            missingRefs: [],
            missingState: [],
            error: detail,
          });
          console.log(`  ${fakeServiceName(service)}: state FAILED ${detail}`);
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`  harness: FAILED ${detail}`);
      checks.push({
        service: 'google',
        tenant: tenantId,
        missingRefs: [],
        missingState: [],
        error: detail,
      });
    } finally {
      for (const tenant of Object.values(session.tenants)) await tenant?.dispose().catch(() => {});
      for (const endpoint of session.forwards.splice(0, session.forwards.length)) endpoint.stop();
    }
    const passed =
      checks.length > 0 &&
      checks.every(
        (check) =>
          !check.error && check.missingRefs.length === 0 && check.missingState.length === 0,
      );
    console.log(`  ${passed ? 'PASS' : 'FAIL'} ${task.id}; tenants deleted`);
    results.push({ task: task.id, title: task.title, passed, checks });
  }
  return results;
}

function contextFor(
  config: RunConfig,
  session: Session,
  threadId: string,
  telegram: TelegramOwner | undefined,
  clock: Clock,
): TaskContext {
  const otto = session.otto!;
  const say = async (text: string, options: { attach?: Attachment | Attachment[] } = {}) => {
    const attachments = options.attach
      ? Array.isArray(options.attach)
        ? options.attach
        : [options.attach]
      : [];
    if (telegram) {
      if (attachments.length) {
        const messageId = await telegram.sendPhotoBytes(
          attachments[0]!.bytes,
          attachments[0]!.name,
          text,
        );
        session.messageId = messageId;
        return { messageId };
      }
      const messageId = await telegram.say(text);
      session.messageId = messageId;
      return { messageId };
    }
    const ids: string[] = [];
    for (const attachment of attachments)
      ids.push(await otto.upload(attachment.name, attachment.bytes, attachment.mimeType));
    const turnId = await otto.say(threadId, text, ids);
    session.turnId = turnId;
    return { turnId };
  };
  const reply = async (text: string) => {
    if (telegram) {
      const replies = await telegram.replies();
      await telegram.say(text, replies.at(-1)?.messageId);
      return;
    }
    const pending = await otto.approved();
    const target = pending.at(-1)?.messageId ?? (await otto.latestAssistantMessageId(threadId));
    await otto.request('POST', '/api/messages', {
      text,
      threadId,
      ...(target ? { replyToMessageId: target } : {}),
    });
    const turn = await otto.latestTurn(
      threadId,
      session.task.channel === 'telegram' ? 'telegram' : undefined,
    );
    if (turn.id) session.turnId = turn.id;
  };
  const fake = (service: FakeService) => {
    const tenant = session.tenants[service];
    if (!tenant) throw new Error(`The ${service} fake is not part of this task.`);
    return tenant;
  };
  return {
    task: session.task,
    runId: config.runId,
    tenant: session.tenantId,
    channel: session.task.channel,
    world: session.world,
    otto,
    threadId,
    tenants: session.tenants,
    ...(telegram ? { telegram } : {}),
    clock,
    evidence: session.recorded,
    say,
    drive: (seconds = config.turnSeconds) =>
      otto.drive(threadId, seconds, (approval: PendingApproval) => session.handler(approval)),
    reply,
    approve: () => reply('Yes'),
    deny: () => reply('No'),
    onConfirmation(handler) {
      session.handler = handler ?? confirmationHandler(session.task);
    },
    record(key, value) {
      session.recorded[key] = value;
    },
    workspaceFiles: () => otto.workspaceFiles(threadId),
    state: (service) => fake(service).state(),
    events: (service) => fake(service).events(),
    initial: (service) => session.initial[service],
  };
}

function failureFor(step: string, error: unknown): HarnessFailureEvidence {
  if (error instanceof HarnessError) {
    return {
      step,
      target: error.target,
      detail: error.detail,
      message: `The harness could not ${step}: ${error.detail}.`,
    };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return {
    step,
    target: '',
    detail,
    message: `The harness could not ${step}: ${detail}.`,
  };
}

async function readEvidence<T>(
  failures: HarnessFailureEvidence[],
  label: string,
  read: () => Promise<T>,
  fallback: T,
): Promise<T> {
  console.log(`Collecting ${label}...`);
  try {
    return await read();
  } catch (error) {
    const failure = failureFor(`read ${label}`, error);
    failures.push(failure);
    console.error(`Harness could not read ${label}: ${failure.detail}`);
    return fallback;
  }
}

async function collectEvidence(
  config: RunConfig,
  session: Session,
  threadId: string,
  failures: HarnessFailureEvidence[],
) {
  const otto = session.otto!;
  const fakes: Partial<
    Record<FakeService, { state: Record<string, any>; events: MonitorEvent[] }>
  > = {};
  for (const [service, tenant] of Object.entries(session.tenants) as Array<
    [FakeService, FakeTenant]
  >) {
    const label = `sim-${service}`;
    fakes[service] = {
      state: await readEvidence(failures, `${label} state`, () => tenant.state(), {}),
      events: await readEvidence(failures, `${label} events`, () => tenant.events(), []),
    };
  }
  const apps = await readEvidence(failures, 'Otto apps', () => otto.apps(), []);
  const approvals = await readEvidence(failures, 'Otto approvals', () => otto.approvals(), []);
  const discovered = await readEvidence(
    failures,
    'Otto discovered connections',
    () => otto.discovered(),
    [],
  );
  const turn = await readEvidence(
    failures,
    'Otto turn',
    () => otto.latestTurn(threadId, session.task.channel === 'telegram' ? 'telegram' : undefined),
    {
      status: session.turnFinished ? 'succeeded' : 'missing',
      seconds: 0,
      ...(session.messageError ? { error: session.messageError } : {}),
    },
  );
  const approvedAction = [...approvals]
    .reverse()
    .find(
      (approval) =>
        approval.turnId === turn.id &&
        ['confirmed', 'executing', 'completed', 'uncertain', 'expired'].includes(approval.status),
    )?.action;
  const preferences = await readEvidence(
    failures,
    'Otto preferences',
    () => otto.preferences(),
    {} as Record<string, any>,
  );
  const memory = await readEvidence(
    failures,
    'Otto memory',
    () => otto.memory(),
    undefined as Record<string, any> | undefined,
  );
  const recorded = session.recorded;
  const telegram = session.telegram;
  const hosts = await readEvidence(
    failures,
    'network probes',
    () => otto.probe(probeHosts(session.services)),
    [],
  );
  const workspace = await readEvidence(
    failures,
    'Otto workspace',
    async () => ({ files: await otto.workspaceFiles(threadId) }),
    { files: [] as string[] },
  );
  const confirmations = await readEvidence(
    failures,
    'Otto confirmations',
    () => otto.pendingConfirmations(),
    [],
  );
  const appWrites = await readEvidence(failures, 'Otto app writes', () => otto.appWrites(), []);
  const schedules = await readEvidence(
    failures,
    'Otto schedules',
    () => otto.schedules(),
    [] as Evidence['schedules'],
  );
  const scheduleRuns = await readEvidence(
    failures,
    'Otto schedule runs',
    () => otto.scheduleRuns(),
    [] as Evidence['scheduleRuns'],
  );
  const turns = await readEvidence(failures, 'Otto turns', () => otto.turns(), []);
  const messages = await readEvidence(
    failures,
    'Otto messages',
    () => otto.messages(threadId),
    [] as Array<Record<string, any>>,
  );
  const turnEvents = await readEvidence(
    failures,
    'Otto turn events',
    () => otto.turnEvents(),
    [] as Evidence['turnEvents'],
  );
  const telegramEvidence = telegram
    ? {
        state: await readEvidence(failures, 'sim-telegram state', () => telegram.state(), {
          bot: { id: 0, username: '', first_name: '' },
          people: [],
          chats: [],
          pending: [],
        } as Awaited<ReturnType<TelegramOwner['state']>>),
        replies: await readEvidence(
          failures,
          'sim-telegram replies',
          () => telegram.replies(),
          [] as Awaited<ReturnType<TelegramOwner['replies']>>,
        ),
      }
    : undefined;
  const telegramState = telegramEvidence?.state;
  const pendingUpdates = Array.isArray(telegramState?.pending) ? telegramState.pending : [];
  const deliveredUpdates = Array.isArray(telegramState?.deliveries)
    ? (telegramState.deliveries as Array<Record<string, any>>).filter(
        (delivery) => Number(delivery.status) >= 200 && Number(delivery.status) < 300,
      )
    : [];
  const telegramReached =
    Boolean(session.messageId) && pendingUpdates.length === 0 && deliveredUpdates.length > 0;
  return {
    task: session.task.id,
    expected: (recorded.expected as Expected | undefined) ?? emptyExpected(),
    transactions: (recorded.transactions as Transaction[] | undefined) ?? [],
    hosts,
    apps: session.task.apps.map((app) => ({
      slug: composioSlugs[app],
      name: appNames[app],
      connected: apps.some(
        (entry) => entry.slug === composioSlugs[app] && entry.status === 'connected',
      ),
    })),
    message: {
      channel: session.task.channel,
      ...(session.turnId ? { turnId: session.turnId } : {}),
      ...(session.messageError ? { error: session.messageError } : {}),
      ...(session.messageId ? { messageId: session.messageId } : {}),
      ...(telegramReached ? { reached: true } : {}),
    },
    turn: {
      status: turn.status,
      seconds: turn.seconds,
      timedOut: session.timedOut,
      limitSeconds: config.turnSeconds,
      ...(turn.error ? { error: turn.error } : {}),
      ...(approvedAction ? { action: approvedAction } : {}),
    },
    toolCalls: ((fakes.composio?.state as ComposioState | undefined)?.tool_calls ??
      []) as Evidence['toolCalls'],
    google:
      (fakes.google?.state as GoogleState | undefined) ??
      ({ tenant: session.tenantId, now: new Date().toISOString() } as GoogleState),
    driveBefore: (session.initial.google?.files ?? []) as Evidence['driveBefore'],
    workspace,
    confirmations,
    appWrites,
    approvals,
    discovered,
    initial: session.initial,
    fakes,
    schedules: schedules as Evidence['schedules'],
    scheduleRuns: scheduleRuns as Evidence['scheduleRuns'],
    notificationRule:
      typeof preferences.notificationRule === 'string' ? preferences.notificationRule : '',
    ...(memory ? { memory: memory as Evidence['memory'] } : {}),
    turns: turns as Evidence['turns'],
    messages: messages as Evidence['messages'],
    turnEvents: turnEvents as Evidence['turnEvents'],
    ...(telegramEvidence ? { telegram: telegramEvidence } : {}),
    ...(recorded.requested ? { requested: recorded.requested as Evidence['requested'] } : {}),
    recorded,
    harnessFailures: failures,
  } satisfies Evidence;
}

function mcpRouter(config: RunConfig, session: Session, vendors: Map<FakeService, Endpoint>) {
  const hosts: Record<string, number> = {};
  for (const app of session.task.apps.filter((item) => mcpServices.includes(item)) as Array<
    'notion' | 'linear'
  >) {
    const endpoint = vendors.get(app);
    if (endpoint) hosts[app === 'notion' ? 'mcp.notion.com' : 'mcp.linear.app'] = endpoint.port();
  }
  return createOAuthRouter({ vendors: hosts, ottoPort: session.otto!.port(), ca: config.ca! });
}

export interface SavedSession {
  version: 1;
  task: string;
  title: string;
  run: string;
  namespace: string;
  fakesNamespace: string;
  pod: string;
  postgres?: string;
  tenant: string;
  services: FakeService[];
  threadId: string;
  turnId?: string;
  messageId?: number;
  messageError?: string;
  timedOut: boolean;
  turnFinished: boolean;
  recorded: Record<string, unknown>;
  initial: Partial<Record<FakeService, Record<string, any>>>;
  tenants: Partial<Record<FakeService, { tenant: string; token: string }>>;
  telegram?: {
    tenant: string;
    botToken: string;
    botUsername: string;
    owner: TelegramOwner['owner'];
    webhookBaseUrl: string;
  };
}

function savedSessionPath(config: RunConfig, task: Task) {
  return resolve(config.root, 'results', config.runId, `${task.id}.session.json`);
}

async function writeSavedSession(config: RunConfig, session: Session) {
  const saved: SavedSession = {
    version: 1,
    task: session.task.id,
    title: session.task.title,
    run: config.runId,
    namespace: config.namespace,
    fakesNamespace: config.fakesNamespace,
    pod: session.pod,
    postgres: session.postgres,
    tenant: session.tenantId,
    services: session.services,
    threadId: session.threadId ?? '',
    ...(session.turnId ? { turnId: session.turnId } : {}),
    ...(session.messageId ? { messageId: session.messageId } : {}),
    ...(session.messageError ? { messageError: session.messageError } : {}),
    timedOut: session.timedOut,
    turnFinished: session.turnFinished,
    recorded: session.recorded,
    initial: session.initial,
    tenants: Object.fromEntries(
      (Object.entries(session.tenants) as Array<[FakeService, FakeTenant]>).map(
        ([service, tenant]) => [service, { tenant: tenant.tenant, token: tenant.token }],
      ),
    ),
    ...(session.telegram
      ? {
          telegram: {
            tenant: session.telegram.tenant,
            botToken: session.telegram.botToken,
            botUsername: session.telegram.botUsername,
            owner: session.telegram.owner,
            webhookBaseUrl: session.telegram.webhookBaseUrl,
          },
        }
      : {}),
  };
  await mkdir(dirname(savedSessionPath(config, session.task)), { recursive: true });
  await writeFile(savedSessionPath(config, session.task), JSON.stringify(saved, null, 2) + '\n');
}

export function regradeCommand(config: RunConfig, task: Task) {
  return `pnpm --dir evals run gym -- --regrade ${config.runId}/${task.id}`;
}

function emptyEvidence(
  config: RunConfig,
  session: Session,
  failures: HarnessFailureEvidence[],
): Evidence {
  return {
    task: session.task.id,
    expected: (session.recorded.expected as Expected | undefined) ?? emptyExpected(),
    transactions: (session.recorded.transactions as Transaction[] | undefined) ?? [],
    hosts: [],
    apps: session.task.apps.map((app) => ({
      slug: composioSlugs[app],
      name: appNames[app],
      connected: false,
    })),
    message: {
      channel: session.task.channel,
      ...(session.turnId ? { turnId: session.turnId } : {}),
      ...(session.messageError ? { error: session.messageError } : {}),
      ...(session.messageId ? { messageId: session.messageId } : {}),
    },
    turn: {
      status: session.turnFinished ? 'succeeded' : 'missing',
      seconds: 0,
      timedOut: session.timedOut,
      limitSeconds: config.turnSeconds,
      ...(session.messageError ? { error: session.messageError } : {}),
    },
    toolCalls: [],
    google: {
      tenant: session.tenantId,
      now: new Date().toISOString(),
      spreadsheets: [],
      files: [],
    },
    driveBefore: [],
    workspace: { files: [] },
    confirmations: [],
    appWrites: [],
    approvals: [],
    initial: session.initial,
    fakes: {},
    schedules: [],
    scheduleRuns: [],
    notificationRule: '',
    turns: [],
    turnEvents: [],
    recorded: session.recorded,
    harnessFailures: failures,
  };
}

async function writeGrade(config: RunConfig, session: Session, evidence: Evidence) {
  const failures = evidence.harnessFailures ?? [];
  let taskChecks: Check[] = [];
  try {
    taskChecks = session.task.checks(evidence);
  } catch (error) {
    const failure = failureFor(`${session.task.id} checks`, error);
    failures.push(failure);
    evidence.harnessFailures = failures;
    console.error(failure.message);
  }
  const checks = [...commonChecks(evidence), ...taskChecks];
  const graded = report(session.task.id, checks);
  const passed = checks.every((check) => check.pass);
  console.log(`\n${graded.text}`);
  const directory = resolve(config.root, 'results', config.runId);
  await mkdir(directory, { recursive: true });
  const resultPath = resolve(directory, `${session.task.id}.json`);
  const result: TaskResult = {
    task: session.task.id,
    title: session.task.title,
    run: config.runId,
    tenant: session.tenantId,
    at: new Date().toISOString(),
    passed,
    summary: graded.summary,
    counts: graded.counts,
    checks,
    resultPath,
    ...(failures.length ? { harnessFailure: true } : {}),
  };
  await writeFile(resultPath, JSON.stringify({ ...result, evidence }, null, 2) + '\n');
  if (session.services.includes('google')) console.log(`\n${dumpSheet(evidence.google)}`);
  for (const [service, value] of Object.entries(evidence.fakes ?? {}) as Array<
    [FakeService, { events: MonitorEvent[] }]
  >)
    console.log(
      `\n${fakeServiceName(service)} events (${value.events.length}):\n${dumpEvents(value.events)}`,
    );
  console.log(`\nResults: ${resultPath}`);
  return result;
}

async function gradeSession(
  config: RunConfig,
  session: Session,
  threadId: string,
  failures: HarnessFailureEvidence[],
) {
  const said = await readEvidence(
    failures,
    'Otto replies',
    () => session.otto!.assistantMessages(threadId),
    [],
  );
  console.log(`\nOtto said:\n${said.join('\n---\n')}`);
  if (session.telegram) {
    const replies = await readEvidence(
      failures,
      'sim-telegram replies',
      () => session.telegram!.replies(),
      [],
    );
    console.log(`\nTelegram replies:\n${replies.map((reply) => reply.text).join('\n---\n')}`);
  }
  const evidence = await collectEvidence(config, session, threadId, failures);
  return writeGrade(config, session, evidence);
}

function stopSession(session: Session) {
  return (async () => {
    if (session.otto) await session.otto.stop().catch(() => {});
    for (const endpoint of session.forwards.splice(0, session.forwards.length)) endpoint.stop();
  })();
}

async function cleanupTask(config: RunConfig, session: Session, keep: boolean, postgres = false) {
  if (keep) return;
  for (const tenant of Object.values(session.tenants)) await tenant?.dispose().catch(() => {});
  await config.kubectl
    .run([
      '-n',
      config.namespace,
      'delete',
      'pod',
      session.pod,
      'service',
      session.pod,
      '--ignore-not-found',
      '--wait=false',
    ])
    .catch(() => '');
  await config.kubectl
    .run(['-n', config.namespace, 'delete', 'secret', session.pod, '--ignore-not-found'])
    .catch(() => '');
  if (postgres)
    await config.kubectl
      .run([
        '-n',
        config.namespace,
        'delete',
        'deployment,service,networkpolicy',
        '-l',
        `otto-eval-postgres=${session.postgres}`,
        '--ignore-not-found',
        '--wait=false',
      ])
      .catch(() => '');
}

export async function runTask(config: RunConfig, task: Task): Promise<TaskResult> {
  const pod = taskPod(config, task);
  const postgres = postgresName(config.runId, task.id);
  const tenantId = taskTenant(config, task);
  const services = requiredFakes(task.apps, task.channel);
  const world = task.world();
  world.now ??= new Date().toISOString();
  if (task.channel === 'telegram') defaultTelegram(world);
  const session: Session = {
    task,
    pod,
    postgres,
    tenantId,
    world,
    services,
    addresses: {},
    tenants: {},
    initial: {},
    forwards: [],
    timedOut: false,
    turnFinished: false,
    recorded: {},
    handler: confirmationHandler(task),
  };
  const failures: HarnessFailureEvidence[] = [];
  let keepOnFailure = config.keep;
  let saved = false;
  const secret = pod;
  try {
    console.log(`\n${task.title}`);
    await writeSavedSession(config, session);
    saved = true;
    for (const service of services) {
      session.addresses[service] = await serviceIP(config, service);
      if (!session.addresses[service])
        throw new Error(`Could not resolve ${fakeServiceName(service)}.`);
    }
    console.log(`Creating ${services.join(', ')} tenants ${tenantId}...`);
    const { token, vendorEndpoints } = await createFakes(config, session);
    const composio = session.tenants.composio;
    const composioKey =
      typeof composio?.view.api_key === 'string' ? (composio.view.api_key as string) : '';
    const connections = composio
      ? connectedAccounts((await composio.state()) as ComposioState)
      : [];
    for (const [service, tenant] of Object.entries(session.tenants) as Array<
      [FakeService, FakeTenant]
    >)
      session.initial[service] = await tenant.state();
    await writeSavedSession(config, session);
    const telegramTenant = session.tenants.telegram;
    if (telegramTenant)
      session.telegram = telegramOwnerFromTenant({
        admin: telegramTenant.admin,
        tenant: telegramTenant.tenant,
        adminToken: telegramTenant.token,
        harnessToken: config.harnessToken,
        view: telegramTenant.view,
        webhookBaseUrl: telegramWebhookBaseUrl(config.namespace, pod),
      });
    const databasePassword = randomBytes(18).toString('hex');
    const databaseUrl = `postgres://otto:${databasePassword}@${postgres}:5432/otto`;
    const vaultKey = randomBytes(32).toString('base64');
    await config.kubectl.apply(
      JSON.stringify({
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: secret, namespace: config.namespace },
        type: 'Opaque',
        stringData: {
          COMPOSIO_API_KEY: composioKey,
          LLM_API_KEY: config.llmKey,
          OTTO_VAULT_KEY: vaultKey,
          DATABASE_URL: databaseUrl,
          POSTGRES_PASSWORD: databasePassword,
          ...(session.telegram ? { TELEGRAM_BOT_TOKEN: session.telegram.botToken } : {}),
        },
      }),
    );
    await config.kubectl
      .run([
        '-n',
        config.namespace,
        'delete',
        'deployment,service,networkpolicy',
        '-l',
        `otto-eval-postgres=${postgres}`,
        '--ignore-not-found',
        '--wait=true',
      ])
      .catch(() => '');
    await config.kubectl.apply(
      replace(config.postgresTemplate, {
        NAMESPACE: config.namespace,
        RUN_ID: config.runId,
        POSTGRES_NAME: postgres,
        SECRET_NAME: secret,
        FAKETIME_IMAGE: config.faketimeImage,
      }),
    );
    await config.kubectl.run([
      '-n',
      config.namespace,
      'wait',
      '--for=condition=available',
      `deploy/${postgres}`,
      '--timeout=180s',
    ]);
    const manifest = replace(config.template, {
      NAMESPACE: config.namespace,
      RUN_ID: config.runId,
      POD_NAME: pod,
      POSTGRES_NAME: postgres,
      SECRET_NAME: secret,
      OTTO_IMAGE: config.image,
      WORKSPACE_IMAGE: config.workspaceImage,
      BROWSER_IMAGE: config.browserImage,
      GOOGLE_IP: session.addresses.google ?? '127.0.0.1',
      COMPOSIO_IP: session.addresses.composio ?? '127.0.0.1',
      TELEGRAM_IP: session.addresses.telegram ?? '127.0.0.1',
      HOST_ALIASES: renderHostAliases(hostAliases(services, session.addresses)),
      SIM_PRIVATE_ADDRESSES: privateAddresses(services, session.addresses).join(','),
      LLM_PROVIDER: config.provider,
      LLM_MODEL: config.model,
      LLM_KEY_ENV: config.keyVariable,
      FAKETIME_IMAGE: config.faketimeImage,
    });
    await config.kubectl.apply(manifest);
    await waitFor(
      async () => {
        const phase = (
          await config.kubectl.run([
            '-n',
            config.namespace,
            'get',
            'pod',
            pod,
            '-o',
            'jsonpath={.status.phase}',
          ])
        ).trim();
        if (phase === 'Failed' || phase === 'Succeeded')
          throw new Error(`The Otto pod is ${phase}.`);
        return phase === 'Running' ? true : undefined;
      },
      { seconds: 600, message: 'The Otto pod never started.' },
    );
    session.otto = await startOtto({
      kubectl: config.kubectl,
      namespace: config.namespace,
      pod,
      port: config.ottoPort,
      postgres: `deploy/${postgres}`,
    });
    console.log(`Otto is up in ${config.namespace}/${pod}.`);
    await writeSavedSession(config, session);
    saved = true;
    if (session.telegram)
      await attachTelegramToOtto({
        otto: session.otto,
        telegram: session.telegram,
        publicWebhookUrl: telegramPublicWebhookUrl(pod),
      });
    await session.otto.setTaskLimit(config.taskUsd);
    if (connections.length)
      await session.otto.seedConnections(
        connections,
        createHash('sha256').update(`direct:${composioKey}`).digest('hex'),
      );
    for (const app of task.apps.filter((item) => mcpServices.includes(item)) as Array<
      'notion' | 'linear'
    >) {
      const signIn = session.tenants[app]?.view.sign_in as
        { email?: string; password?: string } | undefined;
      if (!signIn?.email || !signIn.password)
        throw new Error(`The ${app} fake did not return a sign-in account.`);
      console.log(`Connecting ${app} through Otto's MCP sign-in...`);
      await connectMcpApp({
        otto: session.otto,
        slug: app,
        signIn: { email: signIn.email, password: signIn.password },
        router: mcpRouter(config, session, vendorEndpoints),
      });
    }
    session.clock = createClock({
      kubectl: config.kubectl,
      namespace: config.namespace,
      otto: { resource: `pod/${pod}`, container: 'otto' },
      postgres: { resource: `deploy/${postgres}`, container: 'postgres' },
      tenants: (Object.entries(session.tenants) as Array<[FakeService, FakeTenant]>).map(
        ([service, tenant]): ClockTenant => ({
          name: service,
          admin: tenant.admin,
          tenant: tenant.tenant,
          token: tenant.token,
        }),
      ),
    });
    const threadId = await session.otto.thread();
    session.threadId = threadId;
    const ctx = contextFor(config, session, threadId, session.telegram, session.clock);
    try {
      console.log(`Working... (limit ${config.turnSeconds}s)`);
      await task.play(ctx);
      const drive = await ctx.drive();
      session.timedOut = drive.timedOut;
      session.turnFinished = !drive.timedOut;
      if (task.channel === 'telegram')
        session.turnId = (await session.otto.latestTurn(threadId, 'telegram')).id;
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      if (session.turnFinished) {
        const failure = failureFor('Otto after the turn', error);
        failures.push(failure);
        keepOnFailure = true;
        console.error(failure.message);
      } else {
        session.messageError = error instanceof Error ? error.message : String(error);
        console.error(`Task play failed: ${session.messageError}`);
        session.timedOut = true;
      }
    }
    await writeSavedSession(config, session);
    const result = await gradeSession(config, session, threadId, failures);
    if (failures.length) keepOnFailure = true;
    if (result.harnessFailure && saved) result.regrade = regradeCommand(config, task);
    return result;
  } catch (error) {
    keepOnFailure = true;
    const failure = failureFor(
      error instanceof HarnessError ? error.step : 'finish the task',
      error,
    );
    failures.push(failure);
    console.error(failure.message);
    if (session.otto && session.threadId) {
      try {
        const result = await gradeSession(config, session, session.threadId, failures);
        if (saved) result.regrade = regradeCommand(config, task);
        return result;
      } catch (gradingError) {
        const gradingFailure = failureFor('grading', gradingError);
        failures.push(gradingFailure);
        console.error(gradingFailure.message);
      }
    }
    const result = await writeGrade(config, session, emptyEvidence(config, session, failures));
    if (saved) result.regrade = regradeCommand(config, task);
    return result;
  } finally {
    await stopSession(session);
    await cleanupTask(config, session, keepOnFailure || config.keep);
  }
}

export async function regradeTask(
  config: RunConfig,
  task: Task,
  saved: SavedSession,
): Promise<TaskResult> {
  const postgres = saved.postgres ?? postgresName(config.runId, task.id);
  const session: Session = {
    task,
    pod: saved.pod,
    postgres,
    tenantId: saved.tenant,
    world: task.world(),
    services: saved.services,
    addresses: {},
    tenants: {},
    initial: saved.initial ?? {},
    forwards: [],
    threadId: saved.threadId,
    ...(saved.turnId ? { turnId: saved.turnId } : {}),
    ...(saved.messageId ? { messageId: saved.messageId } : {}),
    ...(saved.messageError ? { messageError: saved.messageError } : {}),
    timedOut: saved.timedOut,
    turnFinished: saved.turnFinished,
    recorded: saved.recorded ?? {},
    handler: confirmationHandler(task),
  };
  const failures: HarnessFailureEvidence[] = [];
  try {
    session.otto = await startOtto({
      kubectl: config.kubectl,
      namespace: config.namespace,
      pod: saved.pod,
      port: config.ottoPort,
      postgres: `deploy/${postgres}`,
    });
    const admins = new Map<FakeService, Endpoint>();
    for (const service of Object.keys(saved.tenants) as FakeService[]) {
      const admin = await forward(
        config,
        session,
        config.fakesNamespace,
        fakeServiceName(service),
        9090,
      );
      admins.set(service, admin);
      const tenant = saved.tenants[service];
      if (tenant)
        session.tenants[service] = existingFakeTenant({
          service,
          admin,
          tenant: tenant.tenant,
          token: tenant.token,
          harnessToken: config.harnessToken,
        });
    }
    if (saved.telegram) {
      const admin = admins.get('telegram');
      const tenant = saved.tenants.telegram;
      if (!admin || !tenant) throw new Error('The saved Telegram tenant is incomplete.');
      session.telegram = telegramOwnerFromTenant({
        admin,
        tenant: saved.telegram.tenant,
        adminToken: tenant.token,
        harnessToken: config.harnessToken,
        view: {
          tenant: saved.telegram.tenant,
          bot: {
            id: 0,
            username: saved.telegram.botUsername,
            first_name: 'Otto Gym',
            token: saved.telegram.botToken,
          },
          telegram_user: {
            user_id: saved.telegram.owner.userId,
            chat_id: saved.telegram.owner.chatId,
            first_name: saved.telegram.owner.firstName,
            ...(saved.telegram.owner.username ? { username: saved.telegram.owner.username } : {}),
          },
        },
        webhookBaseUrl: saved.telegram.webhookBaseUrl,
      });
    }
    const result = await gradeSession(config, session, saved.threadId, failures);
    if (failures.length) result.regrade = regradeCommand(config, task);
    return result;
  } finally {
    await stopSession(session);
    await cleanupTask(config, session, config.keep, true);
  }
}
