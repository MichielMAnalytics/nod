import { randomBytes } from 'node:crypto';
import { harnessRequest, hostSend, openForward, type HttpInit } from './http.ts';
import type { Kubectl } from './kubectl.ts';
import { waitFor } from './kubectl.ts';

export function threadSettled(latest: string | undefined, active: number) {
  return active === 0 && Boolean(latest) && !['queued', 'running', 'waiting'].includes(latest!);
}

export interface PendingApproval {
  id: string;
  action: string;
  messageId: string;
  question: string;
}

export interface Otto {
  port(): number;
  request(method: string, path: string, body?: unknown): Promise<any>;
  seedConnections(
    connections: Array<{ slug: string; accountId: string; accountEmail?: string }>,
    configurationId: string,
  ): Promise<void>;
  upload(name: string, bytes: Buffer, mimeType: string): Promise<string>;
  thread(): Promise<string>;
  say(threadId: string, text: string, attachmentIds?: string[]): Promise<string>;
  drive(
    threadId: string,
    seconds: number,
    onApproval?: (approval: PendingApproval) => string | null,
    answer?: (approval: PendingApproval, text: string) => Promise<void>,
  ): Promise<{ timedOut: boolean }>;
  latestAssistantMessageId(threadId: string): Promise<string | undefined>;
  apps(): Promise<Array<Record<string, any>>>;
  preferences(): Promise<Record<string, any>>;
  memory(): Promise<Record<string, any>>;
  schedules(): Promise<Array<Record<string, any>>>;
  scheduleRuns(): Promise<Array<Record<string, any>>>;
  turns(): Promise<Array<Record<string, any>>>;
  turnEvents(limit?: number): Promise<Array<Record<string, any>>>;
  approved(): Promise<PendingApproval[]>;
  assistantMessages(threadId: string): Promise<string[]>;
  messages(threadId: string): Promise<Array<Record<string, any>>>;
  probe(hosts: string[]): Promise<Array<{ host: string; ok: boolean; error?: string }>>;
  latestTurn(
    threadId: string,
    channel?: 'telegram',
  ): Promise<{
    id?: string;
    status: string;
    seconds: number;
    error?: string;
  }>;
  approvals(): Promise<
    Array<{
      action: string;
      status: string;
      turnId?: string;
      args?: Record<string, unknown>;
      error?: string;
    }>
  >;
  discovered(): Promise<
    Array<{ service: string; name: string; accountName: string; paths: unknown }>
  >;
  connections(): Promise<Array<{ slug: string; active: boolean; revoked: boolean }>>;
  pendingConfirmations(): Promise<Array<{ action: string; question?: string }>>;
  appWrites(): Promise<Array<{ action: string; source: string }>>;
  workspaceFiles(threadId: string): Promise<string[]>;
  setTaskLimit(usd: number): Promise<void>;
  stop(): Promise<void>;
}

export async function startOtto(options: {
  kubectl: Kubectl;
  namespace: string;
  pod: string;
  port: number;
  postgres: string;
}): Promise<Otto> {
  const { kubectl, namespace, pod, port, postgres } = options;
  const origin = `http://127.0.0.1:${port}`;
  const endpoint = await openForward({
    kubectl,
    namespace,
    target: `pod/${pod}`,
    remote: port,
    service: 'otto',
  });
  const send = hostSend(`127.0.0.1:${port}`);
  let key = '';
  const pid = () => `${namespace}/${pod}`;
  const psql = async (sql: string) =>
    (
      await kubectl.run([
        '-n',
        namespace,
        'exec',
        postgres,
        '-c',
        'postgres',
        '--',
        'psql',
        '-U',
        'otto',
        '-d',
        'otto',
        '-tA',
        '-c',
        sql,
      ])
    ).trim();
  key = await waitFor(
    async () => {
      const value = (
        await kubectl.run([
          '-n',
          namespace,
          'exec',
          pod,
          '-c',
          'otto',
          '--',
          'cat',
          '/data/access-key',
        ])
      ).trim();
      return value || undefined;
    },
    { seconds: 300, message: `Otto never wrote its access key in ${pid()}.` },
  );
  const cookie = `otto-access-${port}=${key}`;
  const call = (step: string, path: string, init: HttpInit = {}) =>
    harnessRequest(
      endpoint,
      step,
      path,
      {
        ...init,
        headers: {
          ...init.headers,
          origin,
          cookie,
        },
      },
      { send },
    );
  await waitFor(
    async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await call('start Otto', '/api/state').catch(() => undefined);
        if (response?.status === 200) return true;
        if (response) return true;
        await new Promise((done) => setTimeout(done, 500));
      }
      return undefined;
    },
    { seconds: 300, message: `Otto's web server in ${pid()} never answered.` },
  );
  async function json(method: string, path: string, body?: unknown, step?: string) {
    const response = await call(step ?? `call Otto API ${method} ${path}`, path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`${method} ${path} failed (${response.status}): ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : {};
  }
  const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const jsonRows = async <T>(sql: string): Promise<T[]> =>
    JSON.parse((await psql(`SELECT coalesce(json_agg(x),'[]') FROM (${sql}) x`)) || '[]') as T[];
  const approved = async (): Promise<PendingApproval[]> =>
    (
      await jsonRows<PendingApproval>(
        `SELECT a.id, a.action, a.confirmation_message_id AS "messageId", coalesce(m.text,'') AS question
         FROM approvals a LEFT JOIN messages m ON m.id=a.confirmation_message_id
         WHERE a.status='pending' AND a.confirmation_message_id IS NOT NULL ORDER BY a.created_at DESC`,
      )
    ).map((approval) => ({ ...approval, messageId: String(approval.messageId) }));
  return {
    port: () => endpoint.port(),
    request: json,
    async seedConnections(connections, configurationId) {
      for (const connection of connections)
        await psql(
          `INSERT INTO app_connections (owner_id,slug,account_id,provider_id,configuration_id,account_email,account_active,account_checked_at)
           VALUES ('local-development',${sqlString(connection.slug)},${sqlString(connection.accountId)},'composio',${sqlString(configurationId)},${connection.accountEmail ? sqlString(connection.accountEmail) : 'NULL'},true,now())
           ON CONFLICT (owner_id,provider_id,account_id) WHERE account_id IS NOT NULL DO UPDATE SET
             slug=EXCLUDED.slug, configuration_id=EXCLUDED.configuration_id, account_email=EXCLUDED.account_email,
             account_active=true, account_checked_at=now(), revoked=false`,
        );
    },
    async upload(name, bytes, mimeType) {
      const boundary = `----otto-${randomBytes(12).toString('hex')}`;
      const safeName = name.replace(/[\r\n"]/g, '');
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const response = await call(`upload ${name}`, '/api/uploads', {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        body: Buffer.concat([head, bytes, tail]),
      });
      if (!response.ok)
        throw new Error(`Upload failed (${response.status}): ${await response.text()}`);
      return (await response.json()).id as string;
    },
    async thread() {
      const state = await json('GET', '/api/state');
      if (typeof state.threadId !== 'string') throw new Error('Otto has no active conversation.');
      return state.threadId;
    },
    async say(threadId, text, attachmentIds = []) {
      const result = await json('POST', '/api/messages', { text, attachmentIds, threadId });
      if (typeof result.turnId !== 'string') throw new Error('Otto did not start a turn.');
      return result.turnId;
    },
    approved,
    async drive(threadId, seconds, onApproval, answer) {
      const deadline = Date.now() + seconds * 1000;
      const replied = new Set<string>();
      let leftOpen = false;
      for (;;) {
        const [latest] = await jsonRows<{ status: string }>(
          `SELECT status FROM turns WHERE thread_id=${sqlString(threadId)} AND NOT background ORDER BY created_at DESC, id DESC LIMIT 1`,
        );
        const active = Number(
          await psql(
            `SELECT count(*) FROM turns WHERE thread_id=${sqlString(threadId)} AND NOT background AND status IN ('queued','running')`,
          ),
        );
        if (threadSettled(latest?.status, active)) return { timedOut: false };
        const pending = await approved();
        for (const approval of pending) {
          if (replied.has(approval.id)) continue;
          const text = onApproval ? onApproval(approval) : 'Yes';
          replied.add(approval.id);
          if (text === null) {
            leftOpen = true;
            continue;
          }
          console.log(
            `Answering ${approval.action} (${approval.id}) with ${JSON.stringify(text)}.`,
          );
          if (answer) await answer(approval, text);
          else
            await json('POST', '/api/messages', {
              text,
              replyToMessageId: approval.messageId,
              threadId,
            });
        }
        if (leftOpen && active === 0) return { timedOut: false };
        if (Date.now() >= deadline) return { timedOut: true };
        await new Promise((done) => setTimeout(done, 2000));
      }
    },
    async latestAssistantMessageId(threadId) {
      const [row] = await jsonRows<{ id: string }>(
        `SELECT id FROM messages WHERE thread_id=${sqlString(threadId)} AND role='assistant' AND length(trim(text))>0 ORDER BY created_at DESC, id DESC LIMIT 1`,
      );
      return row?.id;
    },
    async apps() {
      return json('GET', '/api/apps');
    },
    async preferences() {
      return json('GET', '/api/preferences');
    },
    async memory() {
      return json('GET', '/api/memory');
    },
    async schedules() {
      return jsonRows(
        'SELECT id,title,prompt,cron,time_zone AS "timeZone",enabled,kind,delivery_channel AS "deliveryChannel" FROM schedules ORDER BY created_at,id',
      );
    },
    async scheduleRuns() {
      return jsonRows(
        'SELECT r.id,r.schedule_id AS "scheduleId",r.title,r.turn_id AS "turnId",r.scheduled_for AS "scheduledFor",r.time_zone AS "timeZone",u.status FROM schedule_runs r LEFT JOIN turns u ON u.id=r.turn_id ORDER BY r.created_at,r.id',
      );
    },
    async turns() {
      return jsonRows(
        'SELECT id,thread_id AS "threadId",session_id AS "sessionId",source,source_id AS "sourceId",channel,status,background,error,created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt" FROM turns ORDER BY created_at,id',
      );
    },
    async turnEvents(limit = 2000) {
      return jsonRows(
        `SELECT id,turn_id AS "turnId",session_id AS "sessionId",type,summary,created_at AS "createdAt" FROM turn_events ORDER BY created_at,id LIMIT ${Number(limit)}`,
      );
    },
    async assistantMessages(threadId) {
      const rows = await psql(
        `SELECT coalesce(json_agg(text),'[]') FROM (SELECT text FROM messages WHERE thread_id=${sqlString(threadId)} AND role='assistant' AND length(trim(text))>0 ORDER BY created_at, id) m`,
      );
      return JSON.parse(rows || '[]') as string[];
    },
    async messages(threadId) {
      return jsonRows(
        `SELECT m.text, m.turn_id AS "turnId", t.session_id AS "sessionId", t.source, m.created_at AS "createdAt" FROM messages m LEFT JOIN turns t ON t.id=m.turn_id WHERE m.thread_id=${sqlString(threadId)} AND m.role='assistant' AND length(trim(m.text))>0 ORDER BY m.created_at, m.id`,
      );
    },
    async probe(hosts) {
      const script =
        'const https=require("node:https");' +
        'const req=https.get("https://"+process.argv[1]+"/",{timeout:10000},res=>{res.resume();res.on("end",()=>process.exit(0))});' +
        'req.on("timeout",()=>req.destroy(new Error("timeout")));' +
        'req.on("error",error=>{console.error(error.code||error.message||"unreachable");process.exit(1)});';
      const probed = [];
      for (const host of hosts) {
        try {
          await kubectl.run([
            '-n',
            namespace,
            'exec',
            pod,
            '-c',
            'otto',
            '--',
            'node',
            '-e',
            script,
            host,
          ]);
          probed.push({ host, ok: true });
        } catch (error) {
          const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
          const detail =
            stderr.split('\n').filter(Boolean).at(-1) ?? (error as Error).message.split('\n')[0]!;
          probed.push({ host, ok: false, error: detail });
        }
      }
      return probed;
    },
    async latestTurn(threadId, channel) {
      const [row] = await jsonRows<{
        id: string;
        status: string;
        seconds: number;
        error?: string;
      }>(
        `SELECT id,status,EXTRACT(EPOCH FROM (COALESCE(finished_at,now())-created_at)) AS seconds,error FROM turns WHERE thread_id=${sqlString(threadId)} AND NOT background${channel === 'telegram' ? " AND channel LIKE 'telegram:%'" : ''} ORDER BY created_at DESC, id DESC LIMIT 1`,
      );
      if (!row) return { status: 'missing', seconds: 0 };
      const seconds = Number(row.seconds);
      return {
        id: row.id,
        status: row.status,
        seconds: Number.isFinite(seconds) ? seconds : 0,
        ...(row.error ? { error: row.error } : {}),
      };
    },
    async approvals() {
      return jsonRows(
        'SELECT action,status,execution_turn_id AS "turnId",args FROM approvals ORDER BY created_at',
      );
    },
    async discovered() {
      return jsonRows(
        'SELECT service,name,account_name AS "accountName",paths FROM discovered_connections ORDER BY created_at',
      );
    },
    async connections() {
      return jsonRows(
        'SELECT slug,account_active AS active,revoked FROM app_connections WHERE account_id IS NOT NULL',
      );
    },
    async pendingConfirmations() {
      return jsonRows(
        "SELECT a.action, m.text AS question FROM approvals a LEFT JOIN messages m ON m.id=a.confirmation_message_id WHERE a.status='pending' ORDER BY a.created_at",
      );
    },
    async appWrites() {
      return jsonRows(
        'SELECT a.action, t.source FROM app_actions a JOIN turns t ON t.id=a.turn_id ORDER BY a.created_at',
      );
    },
    async workspaceFiles(threadId) {
      try {
        const output = await kubectl.run([
          '-n',
          namespace,
          'exec',
          pod,
          '-c',
          'workspace',
          '--',
          'find',
          `/workspace/${threadId}`,
          '-type',
          'f',
          '-not',
          '-path',
          '*/.otto/*',
          '-not',
          '-path',
          '*/node_modules/*',
        ]);
        const prefix = `/workspace/${threadId}/`;
        return output
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
          .sort();
      } catch {
        return [];
      }
    },
    async setTaskLimit(usd) {
      await json('PUT', '/api/trust/limit', { taskUsd: usd });
    },
    async stop() {
      endpoint.stop();
    },
  };
}
