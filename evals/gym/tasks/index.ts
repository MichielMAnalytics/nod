import { readdir } from 'node:fs/promises';
import type { Task } from '../task.ts';

let cached: Task[] | undefined;

export async function gymTasks(): Promise<Task[]> {
  if (cached) return cached;
  const directory = new URL('./', import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => /^\d{2}-[a-z0-9-]+\.ts$/.test(file))
    .sort();
  const tasks: Task[] = [];
  for (const file of files) {
    const module = (await import(new URL(file, directory).href)) as { default?: Task };
    if (!module.default) throw new Error(`${file} has no default task export.`);
    tasks.push(module.default);
  }
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new Error('Two gym tasks share an id.');
  cached = tasks;
  return tasks;
}

export function findTask(tasks: Task[], wanted: string) {
  const value = wanted.trim();
  return tasks.find(
    (task) =>
      task.id === value ||
      task.id.replace(/^\d+-/, '') === value ||
      task.id.slice(0, 2) === value.padStart(2, '0'),
  );
}
