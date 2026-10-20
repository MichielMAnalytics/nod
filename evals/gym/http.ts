import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, createServer } from 'node:net';
import type { ChildProcess } from 'node:child_process';
import type { Kubectl } from './kubectl.ts';
import { waitFor } from './kubectl.ts';

export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface HttpReply {
  ok: boolean;
  status: number;
  headers?: unknown;
  text(): Promise<string>;
  json(): Promise<any>;
}

export type Send = (url: string, init?: HttpInit) => Promise<HttpReply>;

export interface Endpoint {
  readonly service: string;
  port(): number;
  url(path?: string): string;
  exited(): boolean;
  restart(): Promise<void>;
  stop(): void;
}

export interface RetryOptions {
  send?: Send;
  sleep?: (milliseconds: number) => Promise<unknown>;
  attempts?: number;
}

export class HarnessError extends Error {
  constructor(
    readonly step: string,
    readonly target: string,
    readonly detail: string,
    readonly attempts: number,
    cause?: unknown,
  ) {
    super(`${step} failed for ${target}: ${detail}`, cause === undefined ? undefined : { cause });
    this.name = 'HarnessError';
  }
}

const restartCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ECONNABORTED']);

const fetchSend: Send = async (url, init = {}) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body as BodyInit | undefined,
  });
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text: () => response.text(),
    json: () => response.json(),
  };
};

export function hostSend(host: string): Send {
  return (url, init = {}) =>
    new Promise<HttpReply>((done, fail) => {
      const target = new URL(url);
      const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
        {
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          path: `${target.pathname}${target.search}`,
          method: init.method ?? 'GET',
          headers: { ...init.headers, host },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.once('error', fail);
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            const body = Buffer.concat(chunks);
            done({
              ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
              status: response.statusCode ?? 0,
              headers: response.headers,
              text: async () => body.toString('utf8'),
              json: async () => JSON.parse(body.toString('utf8')),
            });
          });
        },
      );
      request.once('error', fail);
      if (init.body !== undefined) request.write(init.body);
      request.end();
    });
}

function failureCause(error: unknown): string {
  const cause = (error as { cause?: { code?: string; message?: string } } | undefined)?.cause;
  const code = cause?.code ?? (error as { code?: string } | undefined)?.code;
  if (code) return code;
  if (cause?.message) return cause.message;
  return error instanceof Error ? error.message : String(error);
}

function backoff(attempt: number) {
  return 200 * 2 ** (attempt - 1);
}

export async function harnessRequest(
  endpoint: Endpoint,
  step: string,
  path: string,
  init: HttpInit = {},
  options: RetryOptions = {},
): Promise<HttpReply> {
  const send = options.send ?? fetchSend;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds)));
  const attempts = options.attempts ?? 4;
  let detail = 'unknown error';
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await send(endpoint.url(path), init);
    } catch (error) {
      last = error;
      detail = failureCause(error);
      if (attempt >= attempts) break;
      if (endpoint.exited() || restartCodes.has(detail)) {
        try {
          await endpoint.restart();
        } catch (restartError) {
          last = restartError;
          detail = failureCause(restartError);
        }
      }
      await sleep(backoff(attempt));
    }
  }
  throw new HarnessError(
    step,
    `${endpoint.service} ${path}`,
    `${detail} after ${attempts} attempts`,
    attempts,
    last,
  );
}

function freePort() {
  return new Promise<number>((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      probe.close(() => (port ? done(port) : fail(new Error('Could not reserve a local port.'))));
    });
  });
}

function portOpen(port: number) {
  return new Promise<boolean>((done) => {
    const socket = connect(port, '127.0.0.1');
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

export interface ForwardOptions {
  kubectl: Kubectl;
  namespace: string;
  target: string;
  remote: number;
  service: string;
  freePort?: () => Promise<number>;
  portOpen?: (port: number) => Promise<boolean>;
}

class KubectlForward implements Endpoint {
  private child?: ChildProcess;
  private localPort = 0;
  private restarting?: Promise<void>;

  constructor(private readonly options: ForwardOptions) {}

  get service() {
    return this.options.service;
  }

  port() {
    return this.localPort;
  }

  url(path = '') {
    return `http://127.0.0.1:${this.localPort}${path.startsWith('/') ? path : `/${path}`}`;
  }

  exited() {
    return !this.child || this.child.exitCode !== null || this.child.signalCode !== null;
  }

  restart() {
    this.restarting ??= this.start().finally(() => {
      this.restarting = undefined;
    });
    return this.restarting;
  }

  private async start() {
    this.child?.kill('SIGTERM');
    const port = await (this.options.freePort ?? freePort)();
    this.localPort = port;
    const child = await this.options.kubectl.forward(
      this.options.namespace,
      this.options.target,
      port,
      this.options.remote,
    );
    this.child = child;
    await waitFor(
      async () => {
        if (await (this.options.portOpen ?? portOpen)(port)) return true;
        return undefined;
      },
      { seconds: 120, message: `Could not port-forward ${this.options.target}.` },
    );
  }

  stop() {
    const child = this.child;
    this.child = undefined;
    child?.kill('SIGTERM');
    if (typeof child?.unref === 'function') child.unref();
  }
}

const forwarders = new Set<Endpoint>();

export function stopForwards() {
  for (const forward of forwarders) forward.stop();
  forwarders.clear();
}

export async function openForward(options: ForwardOptions): Promise<Endpoint> {
  const forward = new KubectlForward(options);
  forwarders.add(forward);
  try {
    await forward.restart();
  } catch (error) {
    forward.stop();
    forwarders.delete(forward);
    throw error;
  }
  return forward;
}
