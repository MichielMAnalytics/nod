import { spawn } from 'node:child_process';
import { access, lstat, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

const role = process.argv[2];
const generation = process.env.OTTO_COMPUTER_GENERATION || '1';
const port = Number(process.env.OTTO_COMPUTER_PORT || 4311);
const stub = process.env.OTTO_SIDECAR_COMMAND
  ? JSON.parse(process.env.OTTO_SIDECAR_COMMAND)
  : undefined;
const inputLimit = role === 'browser' ? 16 * 1024 * 1024 + 1024 : 1024 * 1024 + 1024;
const receiptTimeout = 30_000;
const commands = new Map();
const receipts = new Map();
let worker;
let workerExit;
let server;
let stopping;

function fail(status = 400) {
  return Object.assign(new Error('The computer command could not be completed.'), { status });
}

function socketReady() {
  return new Promise((resolve) => {
    const socket = connect('/data/control.sock');
    const id = '00000000-0000-4000-8000-000000000000';
    let incoming = '';
    const finish = (ready) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(500, () => finish(false));
    socket.setEncoding('utf8');
    socket.once('connect', () =>
      socket.write(
        JSON.stringify({
          type: 'request',
          request: { id, namespace: 'sk-000000000000000000000000', method: 'quiesce' },
        }) + '\n',
      ),
    );
    socket.on('data', (chunk) => {
      incoming += chunk;
      const end = incoming.indexOf('\n');
      if (end < 0) return;
      try {
        const response = JSON.parse(incoming.slice(0, end));
        finish(response.id === id && response.ok === true && response.result === true);
      } catch {
        finish(false);
      }
    });
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

function live() {
  return !stopping && (stub !== undefined || role === 'workspace' || worker !== undefined);
}

function body(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) return reject(fail(413));
      chunks.push(chunk);
    });
    request.once('error', () => reject(fail(503)));
    request.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

function decode(bytes) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw fail(400);
  }
}

function commandKey(id) {
  return `${generation}:${id}`;
}

function expireReceipts() {
  const now = Date.now();
  for (const [id, expires] of receipts) if (expires <= now) receipts.delete(id);
}

function frames(stream, output, type) {
  stream.on('data', (chunk) => {
    if (output.destroyed) return;
    for (let offset = 0; offset < chunk.length; offset += 16 * 1024)
      output.write(
        JSON.stringify({
          type,
          data: chunk.subarray(offset, offset + 16 * 1024).toString('base64'),
        }) + '\n',
      );
  });
}

function writeFrame(command, value) {
  if (command.failed || command.terminal || command.output.destroyed) return;
  command.output.write(JSON.stringify(value) + '\n');
}

function stopProcess(command, signal) {
  if (command.terminal || command.failed) return;
  try {
    if (command.process.exitCode === null && command.process.signalCode === null)
      command.process.kill(signal);
  } catch {}
}

function terminate(command) {
  if (command.terminal || command.failed) return;
  command.failed = true;
  stopProcess(command, 'SIGKILL');
  command.output.destroy();
  void command.process.stdin?.destroy();
}

function finish(command, code) {
  if (command.terminal || command.failed) return;
  writeFrame(command, { type: 'exit', code });
  command.terminal = true;
  command.output.end();
  receipts.set(commandKey(command.id), Date.now() + receiptTimeout);
  commands.delete(commandKey(command.id));
}

function spawnCommand(input) {
  if (input.connected !== undefined || (input.session !== undefined && role !== 'workspace'))
    throw fail(409);
  if (stub) return spawn(stub[0], stub.slice(1), { stdio: 'pipe' });
  if (role === 'browser')
    return spawn(
      process.execPath,
      ['--import', 'tsx', '/app/src/providers/container-browser/bridge.ts'],
      {
        cwd: '/app',
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/node', LANG: 'C.UTF-8' },
        stdio: 'pipe',
      },
    );
  return spawn('python3', ['-I', '-u', '/opt/otto/workspace-command.py'], {
    cwd: `/workspace/${input.threadId}`,
    env: { PATH: process.env.PATH, HOME: '/home/node', LANG: 'C.UTF-8' },
    stdio: 'pipe',
  });
}

async function create(request) {
  const input = decode(await body(request, 512));
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) => !['id', 'role', 'threadId', 'connected', 'session'].includes(key),
      ) ||
      input.role !== role ||
      (input.threadId !== undefined && typeof input.threadId !== 'string') ||
      (input.session !== undefined && (input.session !== true || role !== 'workspace')) ||
      (input.connected !== undefined &&
        (!Number.isInteger(input.connected) ||
          input.connected < 20_000 ||
          input.connected >= 60_000 ||
          role !== 'workspace')) ||
      (input.connected && input.session) ||
      (role === 'workspace' && !input.threadId) ||
      (role === 'browser' && input.threadId !== undefined)
    )
      throw fail(400);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.id))
      throw fail(400);
    if (input.threadId !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(input.threadId))
      throw fail(400);
  } catch (error) {
    throw error instanceof Error && 'status' in error ? error : fail(400);
  }
  expireReceipts();
  if (commands.has(commandKey(input.id)) || receipts.has(commandKey(input.id))) throw fail(409);
  if (role === 'workspace' && !stub)
    await mkdir(`/home/node/state/workspace/${input.threadId}`, { recursive: true, mode: 0o700 });
  let process;
  try {
    process = spawnCommand(input);
  } catch (error) {
    throw error instanceof Error && 'status' in error ? error : fail(503);
  }
  const output = new PassThrough();
  const command = {
    id: input.id,
    process,
    output,
    input,
    attached: false,
    ended: false,
    terminal: false,
    failed: false,
  };
  commands.set(commandKey(input.id), command);
  output.on('error', () => {});
  process.stdin.on('error', () => {});
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  frames(process.stdout, output, 'stdout');
  frames(process.stderr, output, 'stderr');
  process.once('error', () => terminate(command));
  process.once('close', (code) => {
    if (command.failed) return;
    if (Number.isSafeInteger(code)) finish(command, code);
    else terminate(command);
  });
  return Response.json({ id: input.id }, { status: 201, headers: { 'cache-control': 'no-store' } });
}

async function control(command, action, request) {
  if (command.failed) throw fail(503);
  if (action === 'output') throw fail(command.terminal ? 409 : 405);
  const bytes = await body(request, action === 'input' ? inputLimit : 128);
  if (command.terminal) {
    if (action === 'input') throw fail(409);
    if (action === 'end' && bytes.byteLength) throw fail(400);
    if (action === 'kill') {
      const value = decode(bytes);
      if (!value || typeof value !== 'object' || Object.keys(value).length !== 1) throw fail(400);
      if (value.signal !== 'SIGTERM' && value.signal !== 'SIGKILL') throw fail(400);
    }
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }
  if (action === 'input') {
    if (command.ended) throw fail(409);
    await new Promise((resolve, reject) => {
      command.process.stdin.write(bytes, (error) => (error ? reject(fail(503)) : resolve()));
    });
  } else if (action === 'end') {
    if (bytes.byteLength) throw fail(400);
    if (!command.ended) {
      command.ended = true;
      command.process.stdin.end();
    }
  } else {
    const value = decode(bytes);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      (value.signal !== 'SIGTERM' && value.signal !== 'SIGKILL')
    )
      throw fail(400);
    stopProcess(command, value.signal);
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

function reject(response, status) {
  response.writeHead(status, { 'cache-control': 'no-store' });
  response.end();
}

async function route(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (request.headers['x-otto-generation'] !== generation) return reject(response, 403);
    if (request.headers['x-otto-computer-role'] !== role) return reject(response, 403);
    const url = new URL(request.url ?? '/', 'http://sidecar');
    if (url.search || url.hash) return reject(response, 404);
    if (url.pathname === '/v1/status' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ live: live() }));
      return;
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      response.writeHead(live() ? 200 : 503).end();
      return;
    }
    if (url.pathname === '/v1/commands' && request.method === 'POST') {
      const result = await create(request);
      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(await result.text());
      return;
    }
    const match = /^\/v1\/commands\/([0-9a-f-]{36})\/(input|end|kill|output)$/.exec(url.pathname);
    if (!match) return reject(response, 404);
    expireReceipts();
    const key = commandKey(match[1]);
    const command = commands.get(key);
    if (match[2] === 'output') {
      if (request.method !== 'GET') return reject(response, 405);
      if (!command) return reject(response, receipts.has(key) ? 409 : 404);
      if (command.attached) return reject(response, 409);
      command.attached = true;
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      command.output.pipe(response);
      response.once('close', () => {
        if (!command.terminal && !command.failed) terminate(command);
      });
      return;
    }
    if (request.method !== 'POST') return reject(response, 405);
    if (!command) {
      if (!receipts.has(key)) return reject(response, 404);
      const result = await control(
        { terminal: true, failed: false, ended: true },
        match[2],
        request,
      );
      response.writeHead(result.status).end();
      return;
    }
    const result = await control(command, match[2], request);
    response.writeHead(result.status).end();
  } catch (error) {
    if (!response.headersSent) reject(response, error && 'status' in error ? error.status : 503);
    else response.destroy();
  }
}

async function stop(code) {
  if (stopping) return stopping;
  stopping = (async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    for (const command of commands.values()) terminate(command);
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM');
      const timer = setTimeout(() => {
        code = 1;
        try {
          process.kill(-worker.pid, 'SIGKILL');
        } catch {}
      }, 10_000);
      await workerExit;
      clearTimeout(timer);
    }
    process.exitCode = code;
  })();
  return stopping;
}

try {
  process.umask(0o077);
  if (
    !['browser', 'workspace'].includes(role) ||
    process.argv.length !== 3 ||
    process.getuid() === 0 ||
    !/^[1-9]\d{0,18}$/.test(generation) ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  )
    throw new Error();
  if (!stub) {
    await access('/opt/otto/checkpoint.py');
    if (role === 'workspace') await access('/opt/otto/workspace-command.py');
  }
  process.once('SIGTERM', () => void stop(0));
  process.once('SIGINT', () => void stop(0));
  if (role === 'browser' && !stub) {
    worker = spawn(
      process.execPath,
      ['--import', 'tsx', '/app/src/providers/container-browser/worker.ts'],
      {
        cwd: '/app',
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/node', LANG: 'C.UTF-8' },
        detached: true,
        stdio: 'ignore',
      },
    );
    workerExit = new Promise((resolve) => {
      worker.once('error', () => resolve(1));
      worker.once('exit', (code) => resolve(code ?? 1));
    });
    void workerExit.then(() => {
      if (!stopping) void stop(1);
    });
    const deadline = Date.now() + 30_000;
    while (!(await socketReady())) {
      if (stopping || Date.now() >= deadline) throw new Error();
      await delay(100);
    }
  }
  if (!stopping) {
    server = createServer((request, response) => void route(request, response));
    server.requestTimeout = 5_000;
    server.headersTimeout = 5_000;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  }
} catch {
  await stop(1);
}
