import type { Clock } from './clock.ts';
import type { MonitorEvent } from './fakes.ts';
import type { Otto, PendingApproval } from './otto.ts';
import type { Task } from './task.ts';
import type { TelegramOwner } from './telegram.ts';
import type { World } from './world.ts';
import type { FakeService, FakeTenant } from './fakes.ts';

export interface Attachment {
  name: string;
  bytes: Buffer;
  mimeType: string;
}

export interface SayOptions {
  attach?: Attachment | Attachment[];
}

export interface Said {
  turnId?: string;
  messageId?: number;
}

export type ConfirmationHandler = (approval: PendingApproval) => string | null;

export interface TaskContext {
  task: Task;
  runId: string;
  tenant: string;
  channel: 'web' | 'telegram';
  world: World;
  otto: Otto;
  threadId: string;
  tenants: Partial<Record<FakeService, FakeTenant>>;
  telegram?: TelegramOwner;
  clock: Clock;
  evidence: Record<string, unknown>;
  say(text: string, options?: SayOptions): Promise<Said>;
  drive(seconds?: number): Promise<{ timedOut: boolean }>;
  reply(text: string): Promise<void>;
  approve(): Promise<void>;
  deny(): Promise<void>;
  onConfirmation(handler: ConfirmationHandler | null): void;
  record(key: string, value: unknown): void;
  workspaceFiles(): Promise<string[]>;
  state(service: FakeService): Promise<Record<string, any>>;
  events(service: FakeService): Promise<MonitorEvent[]>;
  initial(service: FakeService): Record<string, any> | undefined;
}
