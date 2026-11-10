import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { registerLocalAccess } from '../../../src/server/access.ts';

interface FixtureMessage {
  id: string;
  clientMessageId?: string;
  role: 'user' | 'assistant';
  text: string;
  turnId: string;
  createdAt: string;
}

interface FixtureStore {
  messages: FixtureMessage[];
  turn: 'idle' | 'running' | 'waiting' | 'cancelled';
}

const port = Number(process.env.NOD_VALIDATION_PORT);
const token = process.env.NOD_VALIDATION_TOKEN ?? '';
const controlToken = process.env.NOD_VALIDATION_CONTROL_TOKEN ?? '';
const dataPath = process.env.NOD_VALIDATION_DATA ?? '';
const origin = `http://127.0.0.1:${port}`;
const threadId = '00000000-0000-4000-8000-000000000001';
const initialStore: FixtureStore = {
  turn: 'idle',
  messages: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      role: 'assistant',
      text: 'Synthetic history ready',
      turnId: '00000000-0000-4000-8000-000000000003',
      createdAt: '2026-11-06T12:00:00.000Z',
    },
  ],
};

if (!Number.isInteger(port) || port < 1 || port > 65535 || !token || !controlToken || !dataPath)
  throw new Error('Invalid validation fixture configuration.');

const store = JSON.parse(
  await readFile(dataPath, 'utf8').catch(() => JSON.stringify(initialStore)),
) as FixtureStore;
let persistence = Promise.resolve();
const persist = () => {
  const snapshot = JSON.stringify(store);
  persistence = persistence.then(() => writeFile(dataPath, snapshot));
  return persistence;
};
const app = Fastify({ logger: false, trustProxy: false, forceCloseConnections: true });
const streams = new Set<ServerResponse>();
const frame = (payload: object) => `data: ${JSON.stringify(payload)}\n\n`;
const emit = (payload: object) => {
  const event = frame(payload);
  for (const stream of streams) if (!stream.destroyed) stream.write(event);
};
const emitRefresh = () => emit({ type: 'refresh' });
const controlled = (headers: Record<string, unknown>) =>
  headers['x-fixture-control'] === controlToken;
const view = () => ({
  threadId,
  revision: `${store.messages.length}:${store.turn}`,
  messages: store.messages,
  turns: [
    {
      id: '00000000-0000-4000-8000-000000000004',
      status: store.turn,
      createdAt: '2026-11-06T12:00:00.000Z',
    },
  ],
  turn: store.turn,
});

registerLocalAccess(app, port, { key: token, origin, bearer: true });
app.addHook('preClose', async () => {
  for (const stream of streams) stream.end();
});
app.get('/api/client/capabilities', async () => ({
  contractVersion: 1,
  authentication: { mode: 'bearer' },
}));
app.get('/api/session', async () => ({
  threadId,
  user: { id: '00000000-0000-4000-8000-000000000005' },
}));
app.get('/fixture/info', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  return { fixture: 'nod-synthetic-validation-v1', syntheticOnly: true };
});
app.get('/api/schedules', async () => []);
app.get('/api/trust', async () => ({
  month: {
    start: '2026-11-01T00:00:00.000Z',
    days: 30,
    elapsedDays: 9,
    spentUsd: 0,
    forecastUsd: 0,
    planUsd: 0,
    planUsage: false,
    unpriced: false,
    daily: [0],
  },
  entries: [],
  next: null,
  limit: null,
}));
app.get('/api/state', async () => view());
app.get('/api/messages', async () => ({ messages: store.messages, hasMore: false }));
app.post('/api/messages', async (request, reply) => {
  const body = request.body as { clientMessageId?: unknown; text?: unknown; threadId?: unknown };
  if (
    typeof body?.clientMessageId !== 'string' ||
    typeof body.text !== 'string' ||
    (body.threadId !== undefined && body.threadId !== threadId)
  )
    return reply.code(400).send({ error: 'Invalid synthetic message.' });
  const existing = store.messages.find(
    (message) =>
      message.clientMessageId === body.clientMessageId || message.id === body.clientMessageId,
  );
  if (existing) return { messageId: existing.id, turnId: existing.turnId };
  const message: FixtureMessage = {
    id: body.clientMessageId,
    clientMessageId: body.clientMessageId,
    role: 'user',
    text: body.text,
    turnId: randomUUID(),
    createdAt: new Date(Date.UTC(2026, 10, 6, 12, 0, store.messages.length)).toISOString(),
  };
  store.messages.push(message);
  store.turn = 'running';
  await persist();
  emitRefresh();
  return { messageId: message.id, turnId: message.turnId };
});
app.post('/api/thread/stop', async () => {
  store.turn = 'cancelled';
  await persist();
  emitRefresh();
  return { ok: true };
});
app.get('/api/events', async (_request, reply) => {
  reply.hijack();
  streams.add(reply.raw);
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  reply.raw.write(frame({ type: 'refresh' }));
  reply.raw.on('close', () => streams.delete(reply.raw));
});
app.post('/fixture/stream', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  emit({
    type: 'activity',
    items: [
      {
        turnId: '00000000-0000-4000-8000-000000000006',
        title: 'Synthetic validation work',
        since: '2026-11-06T12:01:00.000Z',
      },
    ],
  });
  emit({
    type: 'delta',
    threadId,
    turnId: '00000000-0000-4000-8000-000000000006',
    streamId: 'synthetic-validation-stream',
    text: 'Synthetic streamed reply',
    done: false,
  });
  return { ok: true };
});
app.post('/fixture/wait', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  store.turn = 'waiting';
  await persist();
  emitRefresh();
  return { ok: true };
});
app.post('/fixture/interrupt', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  const body = request.body as { id?: unknown; text?: unknown };
  if (typeof body?.id !== 'string' || typeof body.text !== 'string')
    return reply.code(400).send({ error: 'Invalid synthetic interruption.' });
  for (const stream of [...streams]) stream.end();
  if (!store.messages.some((message) => message.id === body.id)) {
    store.messages.push({
      id: body.id,
      role: 'assistant',
      text: body.text,
      turnId: randomUUID(),
      createdAt: new Date(Date.UTC(2026, 10, 6, 12, 0, store.messages.length)).toISOString(),
    });
    await persist();
  }
  return { ok: true };
});
app.post('/fixture/reply', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  const body = request.body as { id?: unknown; text?: unknown };
  if (typeof body?.id !== 'string' || typeof body.text !== 'string')
    return reply.code(400).send({ error: 'Invalid synthetic reply.' });
  if (!store.messages.some((message) => message.id === body.id)) {
    store.messages.push({
      id: body.id,
      role: 'assistant',
      text: body.text,
      turnId: randomUUID(),
      createdAt: new Date(Date.UTC(2026, 10, 6, 12, 0, store.messages.length)).toISOString(),
    });
    await persist();
  }
  emitRefresh();
  return { ok: true };
});

await app.listen({ host: '127.0.0.1', port });
process.stdout.write(`${JSON.stringify({ ready: true })}\n`);

const close = async () => {
  await app.close();
  await persistence;
};
process.once('SIGTERM', () => void close().then(() => process.exit(0)));
process.once('SIGINT', () => void close().then(() => process.exit(0)));
