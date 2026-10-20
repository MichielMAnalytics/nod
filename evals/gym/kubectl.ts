import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export function createKubectl(context?: string) {
  const prefix = context ? ['--context', context] : [];
  const run = async (args: string[]) => {
    const { stdout } = await exec('kubectl', [...prefix, ...args], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  };
  return {
    run,
    async apply(manifest: string) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('kubectl', [...prefix, 'apply', '-f', '-'], {
          stdio: ['pipe', 'ignore', 'pipe'],
        });
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => (stderr += chunk));
        child.once('error', reject);
        child.once('close', (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`kubectl apply failed (${code}): ${stderr.slice(0, 800)}`)),
        );
        child.stdin.end(manifest);
      });
    },
    async forward(namespace: string, target: string, local: number, remote: number) {
      const child = spawn(
        'kubectl',
        [...prefix, '-n', namespace, 'port-forward', target, `${local}:${remote}`],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      child.stderr.resume();
      return child;
    },
    async json<T>(args: string[]): Promise<T> {
      return JSON.parse((await run(args)).trim()) as T;
    },
  };
}

export type Kubectl = ReturnType<typeof createKubectl>;

export async function waitFor<T>(
  check: () => Promise<T | undefined>,
  options: { seconds: number; message: string; intervalMs?: number },
): Promise<T> {
  const deadline = Date.now() + options.seconds * 1000;
  for (;;) {
    const value = await check().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error(options.message);
    await new Promise((done) => setTimeout(done, options.intervalMs ?? 1000));
  }
}
