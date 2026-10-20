import { AsyncLocalStorage } from 'node:async_hooks';

interface LogContext {
  prefix: string;
  lineStart: [boolean, boolean];
}

const contexts = new AsyncLocalStorage<LogContext>();

export function prefixLines(prefix: string, chunk: string, lineStart: boolean) {
  const parts = chunk.split('\n');
  let text = '';
  let start = lineStart;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (start && part) {
      text += `${prefix} ${part}`;
      start = false;
    } else {
      text += part;
      if (part) start = false;
    }
    if (index < parts.length - 1) {
      text += '\n';
      start = true;
    }
  }
  return { text, lineStart: start };
}

export function withTaskLogs<T>(id: string, run: () => Promise<T>): Promise<T> {
  return contexts.run({ prefix: `[${id}]`, lineStart: [true, true] }, run);
}

let installed = false;

export function installTaskLogs() {
  if (installed) return;
  installed = true;
  const streams = [
    [process.stdout, 0],
    [process.stderr, 1],
  ] as const;
  for (const [stream, index] of streams) {
    const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
    (stream as unknown as { write: unknown }).write = (chunk: unknown, ...rest: unknown[]) => {
      const context = contexts.getStore();
      if (!context || typeof chunk !== 'string') return write(chunk, ...rest);
      const prefixed = prefixLines(context.prefix, chunk, context.lineStart[index]!);
      context.lineStart[index] = prefixed.lineStart;
      return write(prefixed.text, ...rest);
    };
  }
}
