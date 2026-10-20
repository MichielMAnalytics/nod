import type {
  ComposioToolCall,
  FakeService,
  GoogleFile,
  GoogleState,
  MonitorEvent,
} from './fakes.ts';
import type { TelegramReply, TelegramState } from './telegram.ts';

export type Layer = 'Setup' | 'Reach' | 'Outcome' | 'Safety';

export interface Check {
  layer: Layer;
  id: string;
  pass: boolean;
  message: string;
  informational?: boolean;
}

export interface Expected {
  currency: string;
  transactions: number;
  openingBalance: number;
  closingBalance: number;
  netCashMovement: number;
  revenue: number;
  operatingExpenses: number;
  netProfit: number;
  netProfitIncludingVat: number;
  netProfitNote: string;
  vatPaid: number;
  drawings: number;
  loanPrincipal: number;
  tolerance: number;
}

export interface Transaction {
  date: string;
  description: string;
  amount: number;
  balance: number;
}

export interface HostProbe {
  host: string;
  ok: boolean;
  error?: string;
}

export interface AppConnection {
  slug: string;
  name: string;
  connected: boolean;
}

export interface TurnEvidence {
  status: string;
  seconds: number;
  timedOut: boolean;
  limitSeconds: number;
  error?: string;
  action?: string;
}

export interface ConfirmationEvidence {
  action: string;
  question?: string;
}

export interface AppWriteEvidence {
  action: string;
  source: string;
  tool?: string;
}

export interface ApprovalEvidence {
  action: string;
  status: string;
  turnId?: string;
  args?: Record<string, unknown>;
  error?: string;
}

export interface DiscoveredEvidence {
  service: string;
  name: string;
  accountName: string;
  paths: unknown;
}

export interface FakeEvidence {
  state: Record<string, any>;
  events: MonitorEvent[];
}

export interface ScheduleEvidence {
  id: string;
  title: string;
  prompt: string;
  cron: string | null;
  timeZone: string;
  enabled: boolean;
  kind: string;
  deliveryChannel: string;
}

export interface ScheduleRunEvidence {
  id: string;
  scheduleId: string;
  title: string;
  turnId: string | null;
  scheduledFor: string;
  timeZone: string;
  status?: string;
}

export interface MemoryNoteEvidence {
  path: string;
  area: string;
  text: string;
  status: string;
  updated: string;
}

export interface MemoryEvidence {
  saving: boolean;
  sensitive: boolean;
  notes: MemoryNoteEvidence[];
  archive: MemoryNoteEvidence[];
  skills: Array<{ name: string; description: string; body: string; learned: string }>;
}

export interface TurnEventEvidence {
  id: string;
  turnId: string;
  sessionId?: string | null;
  type: string;
  summary: string;
  createdAt: string;
}

export interface TelegramEvidence {
  state: TelegramState;
  replies: TelegramReply[];
}

export interface MessageEvidence {
  text: string;
  turnId?: string | null;
  sessionId?: string | null;
  source?: string | null;
  createdAt?: string;
}

export interface HarnessFailureEvidence {
  step: string;
  target: string;
  detail: string;
  message: string;
}

export interface Evidence {
  task: string;
  expected: Expected;
  transactions: Transaction[];
  hosts: HostProbe[];
  apps: AppConnection[];
  message: {
    turnId?: string;
    error?: string;
    messageId?: number;
    channel?: 'web' | 'telegram';
    reached?: boolean;
  };
  turn: TurnEvidence;
  toolCalls: ComposioToolCall[];
  google: GoogleState;
  driveBefore: GoogleFile[];
  workspace: { files: string[]; error?: string };
  confirmations: ConfirmationEvidence[];
  appWrites: AppWriteEvidence[];
  approvals: ApprovalEvidence[];
  discovered?: DiscoveredEvidence[];
  requested?: { prefixes: string[]; description: string };
  initial?: Partial<Record<FakeService, Record<string, any>>>;
  fakes?: Partial<Record<FakeService, FakeEvidence>>;
  schedules?: ScheduleEvidence[];
  scheduleRuns?: ScheduleRunEvidence[];
  notificationRule?: string;
  memory?: MemoryEvidence;
  turns?: Array<Record<string, any>>;
  turnEvents?: TurnEventEvidence[];
  messages?: MessageEvidence[];
  telegram?: TelegramEvidence;
  recorded?: Record<string, unknown>;
  harnessFailures?: HarnessFailureEvidence[];
}
