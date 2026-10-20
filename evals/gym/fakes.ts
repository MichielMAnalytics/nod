import { HarnessError, harnessRequest, type Endpoint } from './http.ts';

export interface GoogleFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  owners?: string[];
  ref?: string;
  modified_at?: string;
}

export interface GoogleSheet {
  spreadsheetId: string;
  title: string;
  owner?: string;
  ref?: string;
  sheets: Array<{
    sheetId?: number;
    title: string;
    rows: unknown[][];
    formatted?: unknown[][];
  }>;
}

export interface GoogleState {
  tenant: string;
  now: string;
  spreadsheets?: GoogleSheet[];
  files?: GoogleFile[];
  permissions?: unknown[];
  shared_drives?: unknown[];
  [key: string]: unknown;
}

export interface ComposioToolCall {
  id?: string;
  at?: string;
  tool: string;
  toolkit: string;
  successful: boolean;
  upstream_status?: number;
  duration_ms?: number;
  error?: string;
}

export interface ComposioState {
  connected_accounts?: Array<Record<string, unknown>>;
  tool_calls?: ComposioToolCall[];
  sessions?: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface MonitorEvent {
  service: string;
  seq: number;
  ts: string;
  kind: string;
  type?: string;
  outcome: string;
  actor?: { type?: string; client?: string; account?: string };
  entity?: { type?: string; id?: string; ref?: string };
  request?: { op?: string; method?: string; path?: string; status?: number };
  detail?: Record<string, unknown>;
}

export interface ConnectionSeed {
  slug: string;
  accountId: string;
  accountName?: string;
  accountEmail?: string;
}

export type FakeService = 'google' | 'slack' | 'notion' | 'linear' | 'telegram' | 'composio';

export interface FakeTenant {
  service: FakeService;
  tenant: string;
  token: string;
  admin: Endpoint;
  view: Record<string, any>;
  state(): Promise<Record<string, any>>;
  events(): Promise<MonitorEvent[]>;
  dispose(): Promise<void>;
}

export interface FakeTenantOptions {
  service: FakeService;
  admin: Endpoint;
  harnessToken: string;
  tenant: string;
  token: string;
  label: string;
  world: Record<string, unknown>;
  webhookBaseUrl?: string;
}

function serviceLabel(service: FakeService) {
  return `sim-${service}`;
}

export async function fakeCall(
  admin: Endpoint,
  step: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<Record<string, any>> {
  const response = await harnessRequest(admin, step, path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = `HTTP ${response.status}: ${text.slice(0, 500)}`;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.trim()) detail = body.error;
    } catch {}
    throw new HarnessError(step, `${admin.service} ${path}`, detail, 1);
  }
  return text ? (JSON.parse(text) as Record<string, any>) : {};
}

function tenantClient(options: {
  service: FakeService;
  admin: Endpoint;
  tenant: string;
  token: string;
  view: Record<string, any>;
  harnessToken?: string;
}) {
  const label = serviceLabel(options.service);
  const tenant = options.tenant;
  const base = `/_sim/v1/tenants/${encodeURIComponent(tenant)}`;
  let disposed = false;
  return {
    service: options.service,
    tenant,
    token: options.token,
    admin: options.admin,
    view: options.view,
    state: () =>
      fakeCall(options.admin, `collect ${label} state`, 'GET', `${base}/state`, options.token),
    events: async () =>
      (await fakeCall(
        options.admin,
        `collect ${label} events`,
        'GET',
        `${base}/monitor?limit=10000`,
        options.token,
      )) as unknown as MonitorEvent[],
    async dispose() {
      if (disposed || !options.harnessToken) return;
      disposed = true;
      await fakeCall(
        options.admin,
        `delete the ${label} tenant`,
        'DELETE',
        base,
        options.harnessToken,
      ).catch(() => {});
    },
  } satisfies FakeTenant;
}

export async function createFakeTenant(options: FakeTenantOptions): Promise<FakeTenant> {
  const body: Record<string, unknown> = {
    admin_token: options.token,
    labels: { rollout_id: options.label },
    world: options.world,
  };
  if (options.webhookBaseUrl) body.webhook_base_url = options.webhookBaseUrl;
  const view = await fakeCall(
    options.admin,
    `create the ${serviceLabel(options.service)} tenant`,
    'PUT',
    `/_sim/v1/tenants/${encodeURIComponent(options.tenant)}`,
    options.harnessToken,
    body,
  );
  return tenantClient({
    service: options.service,
    admin: options.admin,
    tenant: options.tenant,
    token: options.token,
    view,
    harnessToken: options.harnessToken,
  });
}

export function existingFakeTenant(options: {
  service: FakeService;
  admin: Endpoint;
  tenant: string;
  token: string;
  harnessToken?: string;
}): FakeTenant {
  return tenantClient({ ...options, view: {} });
}

export function connectedAccounts(state: ComposioState): ConnectionSeed[] {
  return (Array.isArray(state.connected_accounts) ? state.connected_accounts : [])
    .filter((item: Record<string, any>) => (item.status ?? 'ACTIVE') === 'ACTIVE')
    .map((item: Record<string, any>): ConnectionSeed => ({
      slug: String(item.toolkit),
      accountId: String(item.id),
      ...(typeof item.email === 'string' && item.email ? { accountEmail: item.email } : {}),
    }));
}
