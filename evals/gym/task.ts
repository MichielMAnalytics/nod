import type { Evidence, Check } from './evidence.ts';
import type { GymApp, World } from './world.ts';
import type { TaskContext } from './context.ts';

export interface Task {
  id: string;
  title: string;
  channel: 'web' | 'telegram';
  apps: GymApp[];
  confirmations?: string[];
  world(): World;
  play(ctx: TaskContext): Promise<void>;
  checks(evidence: Evidence): Check[];
}
