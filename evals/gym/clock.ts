import { harnessRequest, type Endpoint } from './http.ts';
import type { Kubectl } from './kubectl.ts';

export const clockFile = '/clock/faketime';

const activeStatuses = new Set(['queued', 'running']);
const dueSources = new Set(['schedule', 'event']);

export interface ClockTenant {
  name: string;
  admin: Endpoint;
  tenant: string;
  token: string;
}

export interface ClockTarget {
  resource: string;
  container: string;
}

export interface ClockTurn {
  id: string;
  source: string;
  status: string;
  started: boolean;
}

export interface ClockRun {
  id: string;
  turnId: string | null;
  turnStatus: string | null;
}

export interface ClockSnapshot {
  turns: ClockTurn[];
  runs: ClockRun[];
  schedules?: number;
}

export interface ClockAdvance {
  offsetSeconds: number;
  fakeNow: Date;
  turns: string[];
  runs: string[];
  waitedSeconds: number;
}

export interface ClockAdvanceOptions {
  timeoutSeconds?: number;
  discoverySeconds?: number;
  settleSeconds?: number;
  intervalMs?: number;
  runs?: number;
}

export interface Clock {
  advance(target: Date | number, options?: ClockAdvanceOptions): Promise<ClockAdvance>;
  now(): Promise<Date>;
}

export interface ClockDependencies {
  kubectl: Pick<Kubectl, 'run'>;
  namespace: string;
  otto: ClockTarget;
  postgres: ClockTarget;
  tenants: ClockTenant[];
  timeoutSeconds?: number;
  discoverySeconds?: number;
  settleSeconds?: number;
  intervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  realNow?: () => Date;
  putTenantClock?: (tenant: ClockTenant, offsetSeconds: number) => Promise<void>;
}

const snapshotSql = `SELECT json_build_object(
  'turns', (SELECT coalesce(json_agg(json_build_object('id',id,'source',source,'status',status,'started',started_at IS NOT NULL)),'[]') FROM turns),
  'runs', (SELECT coalesce(json_agg(json_build_object('id',r.id,'turnId',r.turn_id,'turnStatus',t.status)),'[]') FROM schedule_runs r LEFT JOIN turns t ON t.id=r.turn_id),
  'schedules', (SELECT count(*) FROM schedules WHERE enabled)
)`;

export function clockOffsetSeconds(target: Date | number, now = new Date()) {
  const seconds = target instanceof Date ? (target.getTime() - now.getTime()) / 1000 : target;
  if (!Number.isFinite(seconds)) throw new Error('The gym clock target must be finite.');
  return Math.round(seconds);
}

export function formatClockOffset(target: Date | number, now = new Date()) {
  const offset = clockOffsetSeconds(target, now);
  return offset >= 0 ? `+${offset}` : String(offset);
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((done) => setTimeout(done, milliseconds));
}

async function putClock(tenant: ClockTenant, offsetSeconds: number) {
  const response = await harnessRequest(
    tenant.admin,
    `set the ${tenant.name} clock`,
    `/_sim/v1/tenants/${encodeURIComponent(tenant.tenant)}/clock`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${tenant.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ offset_s: offsetSeconds }),
    },
  );
  const text = await response.text();
  if (!response.ok)
    throw new Error(`PUT ${tenant.name} clock failed (${response.status}): ${text.slice(0, 400)}`);
}

export function createClock(dependencies: ClockDependencies): Clock {
  const {
    kubectl,
    namespace,
    otto,
    postgres,
    tenants,
    sleep = defaultSleep,
    realNow = () => new Date(),
    putTenantClock = putClock,
  } = dependencies;

  const psql = async (sql: string) =>
    kubectl.run([
      '-n',
      namespace,
      'exec',
      postgres.resource,
      '-c',
      postgres.container,
      '--',
      'psql',
      '-U',
      'otto',
      '-d',
      'otto',
      '-tA',
      '-c',
      sql,
    ]);

  const readSnapshot = async (): Promise<ClockSnapshot> => {
    const output = (await psql(snapshotSql)).trim();
    if (!output) return { turns: [], runs: [], schedules: 0 };
    const parsed = JSON.parse(output) as Partial<ClockSnapshot>;
    return {
      turns: Array.isArray(parsed.turns) ? parsed.turns : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      schedules: Number(parsed.schedules) || 0,
    };
  };

  const writeOffset = async (target: ClockTarget, offset: string) =>
    kubectl.run([
      '-n',
      namespace,
      'exec',
      target.resource,
      '-c',
      target.container,
      '--',
      'sh',
      '-c',
      `printf %s "$1" > ${clockFile}`,
      'clock',
      offset,
    ]);

  const readNow = async () => {
    const output = await kubectl.run([
      '-n',
      namespace,
      'exec',
      otto.resource,
      '-c',
      otto.container,
      '--',
      'node',
      '-e',
      'process.stdout.write(String(Date.now()))',
    ]);
    const milliseconds = Number(output.trim());
    if (!Number.isFinite(milliseconds))
      throw new Error(`Otto's faked clock returned ${JSON.stringify(output.slice(0, 80))}.`);
    return new Date(milliseconds);
  };

  async function advance(
    target: Date | number,
    options: ClockAdvanceOptions = {},
  ): Promise<ClockAdvance> {
    const timeoutSeconds = options.timeoutSeconds ?? dependencies.timeoutSeconds ?? 180;
    const discoverySeconds = options.discoverySeconds ?? dependencies.discoverySeconds ?? 35;
    const settleSeconds = options.settleSeconds ?? dependencies.settleSeconds ?? 5;
    const intervalMs = options.intervalMs ?? dependencies.intervalMs ?? 1000;
    const wantedRuns = options.runs ?? 0;
    const before = await readSnapshot();
    const offsetSeconds = clockOffsetSeconds(target, realNow());
    const offset = formatClockOffset(offsetSeconds);
    const startedAt = realNow().getTime();
    for (const clockTarget of [otto, postgres]) await writeOffset(clockTarget, offset);
    for (const tenant of tenants) await putTenantClock(tenant, offsetSeconds);
    const beforeTurns = new Set(before.turns.map((turn) => turn.id));
    const beforeRuns = new Set(before.runs.map((run) => run.id));
    let lastSignature = '';
    let lastChange = startedAt;
    for (;;) {
      const snapshot = await readSnapshot();
      const current = realNow().getTime();
      const turns = snapshot.turns.filter(
        (turn) => dueSources.has(turn.source) && !beforeTurns.has(turn.id),
      );
      const runs = snapshot.runs.filter((run) => !beforeRuns.has(run.id));
      const activeTurns = turns.filter((turn) => activeStatuses.has(turn.status));
      const activeRuns = runs.filter(
        (run) => run.turnStatus !== null && activeStatuses.has(run.turnStatus),
      );
      const signature = JSON.stringify([
        turns.map((turn) => [turn.id, turn.status, turn.started]).sort(),
        runs.map((run) => [run.id, run.turnStatus]).sort(),
      ]);
      if (signature !== lastSignature) {
        lastSignature = signature;
        lastChange = current;
      }
      const elapsed = current - startedAt;
      if (
        elapsed >= discoverySeconds * 1000 &&
        (!snapshot.schedules ||
          runs.filter((run) => run.turnStatus !== null).length >= wantedRuns) &&
        !activeTurns.length &&
        !activeRuns.length &&
        current - lastChange >= settleSeconds * 1000
      )
        return {
          offsetSeconds,
          fakeNow: await readNow(),
          turns: turns.map((turn) => turn.id),
          runs: runs.map((run) => run.id),
          waitedSeconds: Math.round(elapsed / 1000),
        };
      if (elapsed >= timeoutSeconds * 1000) {
        const pending = [...activeTurns, ...activeRuns].map(
          (item) => `${item.id} (${'status' in item ? item.status : item.turnStatus})`,
        );
        throw new Error(
          `Otto had not finished the work due after ${timeoutSeconds}s: ${pending.join(', ') || `${turns.length} due turn(s), ${runs.length} of ${wantedRuns} expected schedule run(s)`}.`,
        );
      }
      await sleep(intervalMs);
    }
  }

  return { advance, now: readNow };
}
