import type { FakeService } from './fakes.ts';

export type GymApp =
  'gmail' | 'calendar' | 'drive' | 'sheets' | 'docs' | 'slack' | 'notion' | 'linear';

export interface WorldPerson {
  ref: string;
  name: string;
  email: string;
  role?: string;
  org?: string;
  [key: string]: unknown;
}

export interface WorldOrg {
  ref: string;
  name: string;
  domain?: string;
  [key: string]: unknown;
}

export interface WorldEntity {
  ref: string;
  kind: string;
  [key: string]: unknown;
}

export interface WorldTimeline {
  at: string;
  ref?: string;
  service?: string;
  action?: string;
  event?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface World {
  world_version: 1;
  now?: string;
  timezone?: string;
  persona: WorldPerson;
  people?: WorldPerson[];
  orgs?: WorldOrg[];
  entities: WorldEntity[];
  placement?: Record<string, string[]>;
  timeline?: WorldTimeline[];
  native?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FakeDefinition {
  service: FakeService;
  apps: GymApp[];
  hosts: string[];
}

export const fakeDefinitions: Record<FakeService, FakeDefinition> = {
  google: {
    service: 'google',
    apps: ['gmail', 'calendar', 'drive', 'sheets', 'docs'],
    hosts: [
      'sheets.googleapis.com',
      'gmail.googleapis.com',
      'www.googleapis.com',
      'oauth2.googleapis.com',
      'accounts.google.com',
      'docs.google.com',
      'docs.googleapis.com',
    ],
  },
  slack: {
    service: 'slack',
    apps: ['slack'],
    hosts: ['slack.com', 'files.slack.com', 'hooks.slack.com'],
  },
  notion: {
    service: 'notion',
    apps: ['notion'],
    hosts: ['api.notion.com', 'mcp.notion.com'],
  },
  linear: {
    service: 'linear',
    apps: ['linear'],
    hosts: ['api.linear.app', 'mcp.linear.app', 'linear.app'],
  },
  telegram: {
    service: 'telegram',
    apps: [],
    hosts: ['api.telegram.org'],
  },
  composio: {
    service: 'composio',
    apps: [],
    hosts: ['backend.composio.dev', 'connect.composio.dev'],
  },
};

export const fakeOrder: FakeService[] = [
  'google',
  'slack',
  'notion',
  'linear',
  'telegram',
  'composio',
];

export const appNames: Record<GymApp, string> = {
  gmail: 'Gmail',
  calendar: 'Google Calendar',
  drive: 'Google Drive',
  sheets: 'Google Sheets',
  docs: 'Google Docs',
  slack: 'Slack',
  notion: 'Notion',
  linear: 'Linear',
};

export const appServices: Record<GymApp, FakeService> = {
  gmail: 'google',
  calendar: 'google',
  drive: 'google',
  sheets: 'google',
  docs: 'google',
  slack: 'slack',
  notion: 'notion',
  linear: 'linear',
};

export const composioSlugs: Record<GymApp, string> = {
  gmail: 'gmail',
  calendar: 'googlecalendar',
  drive: 'googledrive',
  sheets: 'googlesheets',
  docs: 'googledocs',
  slack: 'slack',
  notion: 'notion',
  linear: 'linear',
};

export const mcpServices: GymApp[] = ['notion', 'linear'];

export function fakesNamespace(environment: NodeJS.ProcessEnv = process.env) {
  return environment.FAKES_NAMESPACE?.trim() || 'otto-eval';
}

export function fakeServiceName(service: FakeService) {
  return `sim-${service}`;
}

export function requiredFakes(apps: GymApp[], channel: 'web' | 'telegram'): FakeService[] {
  const required = new Set<FakeService>();
  for (const app of apps) required.add(appServices[app]);
  if (required.has('google') || required.has('slack')) required.add('composio');
  if (channel === 'telegram') required.add('telegram');
  return fakeOrder.filter((service) => required.has(service));
}

const serviceKinds: Record<FakeService, string[]> = {
  google: ['email_thread', 'calendar_event', 'table', 'document', 'file'],
  slack: ['channel', 'chat_message', 'file'],
  notion: ['table', 'document', 'task', 'issue'],
  linear: ['issue', 'task'],
  telegram: ['channel', 'chat_message'],
  composio: [],
};

const serviceAliases: Record<FakeService, string[]> = {
  google: [
    'google',
    'gmail',
    'google_mail',
    'google_sheets',
    'sheets',
    'googlesheets',
    'google_drive',
    'drive',
    'google-drive',
    'google_calendar',
    'calendar',
    'google-calendar',
    'google_docs',
    'docs',
    'google-docs',
  ],
  slack: ['slack'],
  notion: ['notion'],
  linear: ['linear'],
  telegram: ['telegram'],
  composio: [],
};

const serviceNative: Record<FakeService, string[]> = {
  google: [
    'google',
    'gmail',
    'google_mail',
    'google_sheets',
    'google_drive',
    'drive',
    'google_calendar',
    'calendar',
    'google_docs',
    'docs',
  ],
  slack: ['slack'],
  notion: ['notion'],
  linear: ['linear'],
  telegram: ['telegram'],
  composio: [],
};

export function worldForService(world: World, service: FakeService): World {
  const aliases = serviceAliases[service];
  const kinds = serviceKinds[service];
  const entities = world.entities.filter((entity) => {
    if (!kinds.includes(entity.kind)) return false;
    const placed = world.placement?.[entity.ref];
    if (placed) return placed.some((name) => aliases.includes(name));
    return service !== 'telegram';
  });
  const native = Object.fromEntries(
    Object.entries(world.native ?? {}).filter(([key]) => serviceNative[service].includes(key)),
  );
  const timeline = (world.timeline ?? []).filter((item) =>
    item.service ? aliases.includes(item.service) : service !== 'telegram',
  );
  const people =
    service === 'telegram'
      ? (world.people ?? []).filter((person) => Boolean(person.telegram))
      : world.people;
  return {
    ...world,
    ...(people ? { people } : {}),
    entities,
    ...(world.timeline ? { timeline } : {}),
    ...(world.native ? { native } : {}),
  };
}

export function worldFanout(
  world: World,
  apps: GymApp[],
  channel: 'web' | 'telegram',
): Array<{ service: FakeService; world: World }> {
  return requiredFakes(apps, channel)
    .filter((service) => service !== 'composio')
    .map((service) => ({ service, world: worldForService(world, service) }));
}

export interface HostAlias {
  ip: string;
  hostnames: string[];
}

export function hostAliases(
  services: FakeService[],
  addresses: Partial<Record<FakeService, string>>,
): HostAlias[] {
  return fakeOrder
    .filter((service) => services.includes(service))
    .flatMap((service) => {
      const ip = addresses[service]?.trim();
      return ip ? [{ ip, hostnames: [...fakeDefinitions[service].hosts] }] : [];
    });
}

export function renderHostAliases(aliases: HostAlias[]) {
  return aliases
    .flatMap((alias) => [
      `  - ip: ${JSON.stringify(alias.ip)}`,
      '    hostnames:',
      ...alias.hostnames.map((host) => `    - ${JSON.stringify(host)}`),
    ])
    .join('\n');
}

export function privateAddresses(
  services: FakeService[],
  addresses: Partial<Record<FakeService, string>>,
) {
  return [
    ...new Set(
      fakeOrder
        .filter((service) => services.includes(service))
        .map((service) => addresses[service]?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

export function probeHosts(services: FakeService[]) {
  return fakeOrder
    .filter((service) => services.includes(service))
    .flatMap((service) => fakeDefinitions[service].hosts);
}

export function serviceHosts(services: FakeService[]) {
  const hosts: Record<string, FakeService> = {};
  for (const service of services)
    for (const host of fakeDefinitions[service].hosts) hosts[host] = service;
  return hosts;
}
