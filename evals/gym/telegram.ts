import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Otto } from './otto.ts';
import { HarnessError, harnessRequest, type Endpoint } from './http.ts';
import type { World } from './world.ts';

export interface TelegramMessage {
  message_id: number;
  date?: number;
  from?: number;
  from_bot?: boolean;
  text?: string;
  caption?: string;
  reply_to?: number;
  buttons?: unknown;
  photo?: unknown;
  document?: unknown;
}

export interface TelegramReply {
  messageId: number;
  text: string;
  caption?: string;
  replyTo?: number;
  date?: number;
  buttons?: unknown;
  photo?: unknown;
  document?: unknown;
}

export interface TelegramState {
  bot: { id: number; username: string; first_name: string };
  people: Array<Record<string, unknown>>;
  chats: Array<{
    id: number;
    type: string;
    title?: string;
    user_ref?: string;
    first_name?: string;
    username?: string;
    messages: TelegramMessage[];
    bot_can_see: boolean;
  }>;
  webhook?: { url: string; secret_token?: string; allowed_updates?: string[] } | null;
  pending: Array<{ update_id: number; type: string; attempts?: number }>;
  deliveries?: unknown;
  files?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface AdminResponse {
  tenant: string;
  bot: { id: number; username: string; first_name: string; token: string };
  telegram_user: {
    user_id: number;
    chat_id: number;
    first_name: string;
    username?: string;
    started?: boolean;
  };
}

export interface TelegramOwner {
  tenant: string;
  botToken: string;
  botUsername: string;
  owner: { userId: number; chatId: number; firstName: string; username?: string };
  webhookBaseUrl: string;
  say(text: string, replyTo?: number): Promise<number>;
  sendPhoto(path: string, caption?: string, replyTo?: number): Promise<number>;
  sendPhotoBytes(bytes: Buffer, name: string, caption?: string, replyTo?: number): Promise<number>;
  tap(button: string, messageId?: number): Promise<string>;
  replies(since?: number): Promise<TelegramReply[]>;
  state(): Promise<TelegramState>;
  event(event: Record<string, unknown>): Promise<Record<string, any>>;
  dispose(): Promise<void>;
}

export interface TelegramChannel {
  pairingUrl: string;
  channel: Record<string, any>;
}

export function telegramServiceName(runId: string) {
  return runId.startsWith('otto-eval-') ? runId : `otto-eval-${runId}`;
}

export function telegramWebhookBaseUrl(namespace: string, runId: string) {
  return `http://${telegramServiceName(runId)}.${namespace}.svc.cluster.local:4310`;
}

export function telegramPublicWebhookUrl(runId: string) {
  return `https://${telegramServiceName(runId)}.gym.example/api/webhooks/telegram`;
}

export function pairingCode(pairingUrl: string) {
  const code = new URL(pairingUrl).searchParams.get('start');
  if (!code || !/^[A-Za-z0-9_-]{16,64}$/.test(code))
    throw new Error(`Telegram pairing URL has no start code: ${pairingUrl}`);
  return code;
}

export function startCommand(code: string) {
  return `/start ${code}`;
}

export function botReplies(messages: TelegramMessage[], since = 0): TelegramReply[] {
  return messages
    .filter((message) => message.from_bot === true && message.message_id > since)
    .sort((left, right) => left.message_id - right.message_id)
    .map((message) => ({
      messageId: message.message_id,
      text: message.text ?? message.caption ?? '',
      ...(message.caption ? { caption: message.caption } : {}),
      ...(message.reply_to ? { replyTo: message.reply_to } : {}),
      ...(message.date ? { date: message.date } : {}),
      ...(message.buttons ? { buttons: message.buttons } : {}),
      ...(message.photo ? { photo: message.photo } : {}),
      ...(message.document ? { document: message.document } : {}),
    }));
}

function mimeFor(path: string) {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.pdf':
      return 'application/pdf';
    case '.csv':
      return 'text/csv';
    case '.txt':
      return 'text/plain';
    default:
      return 'image/jpeg';
  }
}

export function telegramOwnerFromTenant(options: {
  admin: Endpoint;
  tenant: string;
  adminToken: string;
  harnessToken: string;
  view: AdminResponse | Record<string, any>;
  webhookBaseUrl: string;
}): TelegramOwner {
  const admin = options.admin;
  const tenant = options.tenant;
  const adminToken = options.adminToken;
  const view = options.view as AdminResponse;
  async function call(
    step: string,
    method: string,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<Record<string, any>> {
    const response = await harnessRequest(admin, step, path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = `HTTP ${response.status}: ${text.slice(0, 500)}`;
      try {
        const body = JSON.parse(text) as { error?: unknown };
        if (typeof body.error === 'string' && body.error.trim()) detail = body.error;
      } catch {}
      throw new HarnessError(step, `${admin.service} ${path}`, detail, 1);
    }
    return text ? (JSON.parse(text) as Record<string, any>) : {};
  }
  const botToken = view.bot?.token;
  const botUsername = view.bot?.username;
  const user = view.telegram_user;
  if (!botToken || !botUsername || !user?.user_id || !user.chat_id)
    throw new Error('sim-telegram did not return its bot token and the owner Telegram account.');
  let disposed = false;
  async function state() {
    return (await call(
      'collect sim-telegram state',
      'GET',
      `/_sim/v1/tenants/${tenant}/state`,
      adminToken,
    )) as unknown as TelegramState;
  }
  async function event(payload: Record<string, unknown>) {
    const result = await call(
      'send a sim-telegram event',
      'POST',
      `/_sim/v1/tenants/${tenant}/events`,
      adminToken,
      payload,
    );
    return (result.results?.[0] ?? {}) as Record<string, any>;
  }
  async function say(text: string, replyTo?: number) {
    const result = await event({
      type: 'send_message',
      text,
      ...(replyTo ? { reply_to: String(replyTo) } : {}),
    });
    return Number(result.message_id);
  }
  async function sendPhotoBytes(bytes: Buffer, name: string, caption?: string, replyTo?: number) {
    const result = await event({
      type: 'send_photo',
      content_base64: bytes.toString('base64'),
      name,
      mime: mimeFor(name),
      ...(caption ? { caption } : {}),
      ...(replyTo ? { reply_to: String(replyTo) } : {}),
    });
    return Number(result.message_id);
  }
  async function sendPhoto(path: string, caption?: string, replyTo?: number) {
    return sendPhotoBytes(await readFile(path), basename(path), caption, replyTo);
  }
  async function tap(button: string, messageId?: number) {
    const result = await event({
      type: 'tap_button',
      button,
      ...(messageId ? { message: String(messageId) } : {}),
    });
    return String(result.callback_query_id ?? '');
  }
  async function replies(since = 0) {
    const current = await state();
    const chat = current.chats.find((item) => item.id === user.chat_id);
    if (!chat) return [];
    return botReplies(chat.messages ?? [], since);
  }
  return {
    tenant,
    botToken,
    botUsername,
    owner: {
      userId: user.user_id,
      chatId: user.chat_id,
      firstName: user.first_name,
      ...(user.username ? { username: user.username } : {}),
    },
    webhookBaseUrl: options.webhookBaseUrl,
    say,
    sendPhoto,
    sendPhotoBytes,
    tap,
    replies,
    state,
    event,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await call(
        'delete the sim-telegram tenant',
        'DELETE',
        `/_sim/v1/tenants/${tenant}`,
        options.harnessToken,
      ).catch(() => {});
    },
  };
}

export async function createTelegramTenant(options: {
  admin: Endpoint;
  harnessToken: string;
  label: string;
  webhookBaseUrl: string;
  world: World;
}): Promise<TelegramOwner> {
  const admin = options.admin;
  const tenant = `gym-telegram-${randomBytes(6).toString('hex')}`;
  const adminToken = randomBytes(24).toString('hex');
  const response = await harnessRequest(
    admin,
    'create the sim-telegram tenant',
    `/_sim/v1/tenants/${tenant}`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${options.harnessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        admin_token: adminToken,
        labels: { rollout_id: options.label },
        webhook_base_url: options.webhookBaseUrl,
        world: options.world,
      }),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    let detail = `HTTP ${response.status}: ${text.slice(0, 500)}`;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.trim()) detail = body.error;
    } catch {}
    throw new HarnessError(
      'create the sim-telegram tenant',
      `${admin.service} /_sim/v1/tenants/${tenant}`,
      detail,
      1,
    );
  }
  const view = JSON.parse(text) as AdminResponse;
  return telegramOwnerFromTenant({
    admin,
    tenant,
    adminToken,
    harnessToken: options.harnessToken,
    view,
    webhookBaseUrl: options.webhookBaseUrl,
  });
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function attachTelegramToOtto(options: {
  otto: Pick<Otto, 'request'>;
  telegram: TelegramOwner;
  publicWebhookUrl: string;
  timeoutSeconds?: number;
}): Promise<TelegramChannel> {
  const { otto, telegram } = options;
  const webhookUrl = options.publicWebhookUrl;
  const setup = await otto.request('PUT', '/api/channel-settings/telegram', {
    botToken: telegram.botToken,
    webhookUrl,
  });
  let pairingUrl = typeof setup.pairingUrl === 'string' ? setup.pairingUrl : '';
  if (!pairingUrl) {
    const restarted = await otto.request('POST', '/api/channel-settings/telegram/pairing', {});
    pairingUrl = typeof restarted.pairingUrl === 'string' ? restarted.pairingUrl : '';
  }
  if (!pairingUrl) throw new Error('Otto did not offer a Telegram pairing link.');
  await telegram.say(startCommand(pairingCode(pairingUrl)));
  const deadline = Date.now() + (options.timeoutSeconds ?? 120) * 1000;
  for (;;) {
    try {
      const confirmed = await otto.request('POST', '/api/channel-settings/telegram/confirm', {});
      return { pairingUrl, channel: confirmed.channel ?? {} };
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await sleep(1000);
    }
  }
}
