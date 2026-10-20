import { createHash } from 'node:crypto';
import { withTaskLogs } from './log.ts';

export const postgresPrefix = 'otto-eval-pg-';

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function postgresName(runId: string, taskId: string) {
  const body = [slug(runId), slug(taskId)].filter(Boolean).join('-') || 'task';
  const full = `${postgresPrefix}${body}`;
  if (full.length <= 63) return full;
  const hash = createHash('sha256').update(full).digest('hex').slice(0, 8);
  const head = full.slice(0, 63 - hash.length - 1).replace(/-+$/, '');
  return `${head}-${hash}`;
}

export interface PoolOutcome<T, R> {
  task: T;
  result?: R;
  error?: unknown;
}

export interface PoolOptions<T, R> {
  tasks: T[];
  parallel: number;
  run: (task: T) => Promise<R>;
  id?: (task: T) => string;
  prefix?: boolean;
}

export async function runPool<T, R>(options: PoolOptions<T, R>): Promise<Array<PoolOutcome<T, R>>> {
  const { tasks, run } = options;
  const id = options.id ?? ((task: T) => (task as { id: string }).id);
  const parallel = Math.max(1, Math.min(Math.floor(options.parallel) || 1, tasks.length || 1));
  const outcomes: Array<PoolOutcome<T, R>> = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      const task = tasks[index]!;
      const attempt = () => run(task);
      try {
        const result = await (options.prefix === false
          ? attempt()
          : withTaskLogs(id(task), attempt));
        outcomes[index] = { task, result };
      } catch (error) {
        outcomes[index] = { task, error };
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return outcomes;
}
