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
  const { app, label } = actionTitle(action);
  const title = label ? `${label[0]!.toUpperCase()}${label.slice(1)}` : 'Run an action';
  if (action.startsWith('CONNECTED_') || action.startsWith('mcp__'))
    return { title, app: '', slug: '' };
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

export function approvalContent(action: string, args: unknown) {
  if (
    /^(NOD_|CONNECTED_|mcp__)/.test(action) ||
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args)
  )
    return {};
  const input = args as Record<string, unknown>;
  const fields = fieldKeys.flatMap(([label, keys]) => {
    const value = keys.flatMap((key) => words(input[key])).join(', ');
    return value ? [{ label, value: value.slice(0, 500) }] : [];
  });
  if (!fields.length) return {};
  const raw = bodyKeys.map((key) => input[key]).find((value) => typeof value === 'string');
  const text =
    typeof raw === 'string' && input.is_html === true
      ? raw.replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
      : raw;
  const body = typeof text === 'string' ? text.trim().slice(0, 4000) : '';
  return { fields, ...(body ? { body } : {}) };
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
