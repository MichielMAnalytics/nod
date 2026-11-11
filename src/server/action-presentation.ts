const apps: Record<string, string> = {
  GMAIL: 'Gmail',
  GOOGLECALENDAR: 'Google Calendar',
  GOOGLESHEETS: 'Google Sheets',
  GOOGLEDOCS: 'Google Docs',
  GOOGLEDRIVE: 'Google Drive',
  SLACK: 'Slack',
  NOTION: 'Notion',
  LINEAR: 'Linear',
};

export function actionTitle(action: string) {
  if (action === 'NOD_read_source') return { app: '', label: 'Read source observations' };
  if (action === 'CONNECTED_HTTP') return { app: '', label: 'Call a connected API' };
  if (action === 'CONNECTED_MCP_CALL') return { app: '', label: 'Run a tool on a connected app' };
  if (action === 'CONNECTED_CLI') return { app: '', label: 'Run a connected command line tool' };
  if (action.startsWith('LOCAL_FILES_'))
    return {
      app: 'Local files',
      label: action.slice('LOCAL_FILES_'.length).replaceAll('_', ' ').toLowerCase(),
    };
  const [app, ...words] = action.split('_');
  return {
    app: apps[app!] ?? `${app![0]}${app!.slice(1).toLowerCase()}`,
    label: words.join(' ').toLowerCase(),
  };
}

const nodActions: Array<[string, string]> = [
  ['NOD_browser', 'Continue in the browser'],
  ['NOD_vault_allow', 'Use a saved sign-in'],
  ['NOD_limits_update', 'Change spending limits'],
  ['NOD_model_select', 'Change the model'],
  ['NOD_notification_preferences_update', 'Change notifications'],
  ['NOD_schedule_', 'Change a schedule'],
  ['NOD_memory_', 'Change memory'],
  ['NOD_rules', 'Change your rules'],
  ['NOD_', 'Change a Nod setting'],
];

export function approvalTitle(action: string) {
  const nod = nodActions.find(([prefix]) => action.startsWith(prefix));
  if (nod) return { title: nod[1], app: '', slug: '' };
  const mcp = action.startsWith('mcp__');
  const { app, label } = mcp
    ? {
        app: '',
        label: action
          .split('__')
          .slice(2)
          .join(' ')
          .replace(/[_\s]+/g, ' ')
          .trim(),
      }
    : actionTitle(action);
  const title = label ? `${label[0]!.toUpperCase()}${label.slice(1)}` : 'Run an action';
  if (mcp || action.startsWith('CONNECTED_')) return { title, app: '', slug: '' };
  return { title, app, slug: action.split('_')[0]!.toLowerCase() };
}

const fieldKeys: Array<[string, string[]]> = [
  ['To', ['recipient_email', 'to', 'extra_recipients']],
  ['Cc', ['cc']],
  ['Bcc', ['bcc']],
  ['Channel', ['channel']],
  ['Subject', ['subject']],
];
const bodyKeys = ['body', 'message_body', 'text', 'markdown_text'];

function words(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return Array.isArray(value) ? value.flatMap(words) : [];
}

function listed(values: string[]) {
  const kept: string[] = [];
  let length = 0;
  for (const value of values) {
    if (kept.length && length + value.length > 500) break;
    kept.push(value);
    length += value.length + 2;
  }
  const rest = values.length - kept.length;
  const text = kept.join(', ');
  return rest ? `${text} and ${rest} more` : text;
}

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function character(code: number, fallback: string) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

function without(text: string, pattern: RegExp) {
  for (let pass = 0; pass < 8; pass++) {
    const next = text.replace(pattern, '');
    if (next === text) return text;
    text = next;
  }
  return text.replaceAll('<', '');
}

const hidden = /<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const tag = /<[^>]+>/g;

function plainText(html: string) {
  return without(
    without(html, hidden)
      .replace(
        /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi,
        (_, double, single, bare, label) => {
          const address = String(double ?? single ?? bare ?? '').trim();
          const shown = without(String(label), tag).trim();
          return !address || shown === address ? shown || address : `${shown} (${address})`;
        },
      )
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n'),
    tag,
  )
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, decimal, hex, name) =>
      decimal
        ? character(Number(decimal), match)
        : hex
          ? character(Number.parseInt(hex, 16), match)
          : (entities[String(name).toLowerCase()] ?? match),
    )
    .replace(/\n{3,}/g, '\n\n');
}

export function approvalContent(
  action: string,
  args: unknown,
): { fields?: Array<{ label: string; value: string }>; body?: string; bodyCut?: true } {
  if (
    /^(NOD_|CONNECTED_|mcp__)/.test(action) ||
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args)
  )
    return {};
  const input = args as Record<string, unknown>;
  const fields = fieldKeys.flatMap(([label, keys]) => {
    const value = listed(keys.flatMap((key) => words(input[key])));
    return value ? [{ label, value }] : [];
  });
  if (!fields.length) return {};
  const raw = bodyKeys
    .map((key) => input[key])
    .find((value) => typeof value === 'string' && value.trim());
  if (typeof raw !== 'string') return { fields };
  const html = input.is_html === true;
  const text = (html ? plainText(raw.slice(0, 20_000)) : raw).trim();
  const cut = text.length > 4000 || (html && raw.length > 20_000);
  return {
    fields,
    ...(text ? { body: text.slice(0, 4000) } : {}),
    ...(cut ? { bodyCut: true as const } : {}),
  };
}

const tools: Record<string, string> = {
  bash: 'Ran a command',
  read: 'Read a file',
  write: 'Wrote a file',
  edit: 'Edited a file',
  find: 'Looked for files',
  ls: 'Listed files',
  'web search': 'Searched the web',
  'fetch content': 'Read a web page',
  'get search content': 'Read search results',
  'source check': 'Checked a source',
  browser: 'Used the browser',
  'sign in': 'Signed in',
  pay: 'Entered a card',
  'browser session': 'Opened a saved session',
  apps: 'Used a connected app',
  files: 'Handled local files',
  'manage apps': 'Checked connected apps',
  'manage personal context': 'Checked schedules or memory',
  skills: 'Used a skill',
  'send message': 'Sent you a message',
  'follow up': 'Queued a follow-up',
  delegate: 'Started a helper',
  'ask user': 'Asked you',
  'react to message': 'Reacted to a message',
  task: 'Updated the task',
  'share file': 'Shared a file',
  'create audio': 'Made audio',
};

export function toolTitle(summary: string) {
  const server = /^mcp {2}(.+?) {2}.+$/.exec(summary)?.[1];
  return server ? `Used ${server}` : (tools[summary] ?? summary);
}
