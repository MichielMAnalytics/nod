import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { parse } from 'parse5';
import type { Otto } from './otto.ts';
import type { GymApp } from './world.ts';

export interface SignIn {
  email: string;
  password: string;
}

interface FormField {
  name: string;
  value: string;
  type: string;
  checked: boolean;
}

interface FormButton {
  name?: string;
  value: string;
  id?: string;
  text: string;
}

interface HtmlForm {
  action: string;
  method: string;
  fields: FormField[];
  buttons: FormButton[];
}

export interface OAuthRouter {
  request(
    url: URL,
    options?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>;
}

function attribute(node: any, name: string) {
  const found = (node.attrs ?? []).find((item: any) => item.name === name);
  return found ? String(found.value) : undefined;
}

function textOf(node: any): string {
  if (node.nodeName === '#text') return node.value ?? '';
  return (node.childNodes ?? []).map(textOf).join(' ');
}

export function parseForms(html: string, base: URL): HtmlForm[] {
  const document = parse(html);
  const forms: HtmlForm[] = [];
  function visit(node: any) {
    if (node.nodeName === 'form') {
      const form: HtmlForm = {
        action: new URL(attribute(node, 'action') || base.href, base).href,
        method: (attribute(node, 'method') || 'get').toUpperCase(),
        fields: [],
        buttons: [],
      };
      function inside(child: any) {
        if (child.nodeName === 'input') {
          const name = attribute(child, 'name');
          const type = (attribute(child, 'type') || 'text').toLowerCase();
          if (name)
            form.fields.push({
              name,
              value: attribute(child, 'value') ?? '',
              type,
              checked: attribute(child, 'checked') !== undefined,
            });
          if (name && ['submit', 'button', 'image'].includes(type))
            form.buttons.push({
              name,
              value: attribute(child, 'value') ?? '',
              id: attribute(child, 'id'),
              text: attribute(child, 'value') ?? '',
            });
        } else if (child.nodeName === 'button') {
          const type = (attribute(child, 'type') || 'submit').toLowerCase();
          if (type === 'submit')
            form.buttons.push({
              name: attribute(child, 'name'),
              value: attribute(child, 'value') ?? '',
              id: attribute(child, 'id'),
              text: textOf(child).trim(),
            });
        }
        for (const nested of child.childNodes ?? []) inside(nested);
      }
      for (const child of node.childNodes ?? []) inside(child);
      forms.push(form);
      return;
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(document);
  return forms;
}

function buttonLabel(button: FormButton) {
  return `${button.text} ${button.id ?? ''} ${button.name ?? ''} ${button.value}`.toLowerCase();
}

function allowButton(form: HtmlForm) {
  return form.buttons.find((button) => {
    const label = buttonLabel(button);
    return (
      /allow|authorize|approve|grant|accept|continue|sign in|log in/.test(label) &&
      !/deny|reject|cancel/.test(label)
    );
  });
}

export function chooseForm(forms: HtmlForm[]): HtmlForm | undefined {
  const password = forms.find((form) => form.fields.some((field) => field.type === 'password'));
  if (password) return password;
  const consent = forms.find((form) => allowButton(form));
  if (consent) return consent;
  return forms.length === 1
    ? forms[0]
    : (forms.find((form) => form.method === 'POST') ?? undefined);
}

export function formBody(form: HtmlForm, signIn?: SignIn, page: URL = new URL(form.action)) {
  const body = new URLSearchParams();
  for (const field of form.fields) {
    if (['submit', 'button', 'image', 'reset', 'file'].includes(field.type)) continue;
    if (['checkbox', 'radio'].includes(field.type) && !field.checked) continue;
    if (field.type === 'password') body.set(field.name, signIn?.password ?? '');
    else if (field.type === 'email' || /email|username|login/i.test(field.name))
      body.set(field.name, signIn?.email ?? field.value);
    else body.set(field.name, field.value);
  }
  const submit = allowButton(form) ?? form.buttons[0];
  if (submit?.name) body.set(submit.name, submit.value);
  return { body: body.toString(), action: new URL(form.action, page).href };
}

function isRedirect(status: number) {
  return status >= 300 && status < 400;
}

export async function completeOAuth(
  authorizationUrl: string,
  signIn: SignIn,
  router: OAuthRouter,
  options: { steps?: number } = {},
) {
  let current = new URL(authorizationUrl);
  let response = await router.request(current);
  const limit = options.steps ?? 12;
  for (let step = 0; step < limit; step++) {
    if (isRedirect(response.status)) {
      const location = response.headers.location;
      if (!location)
        throw new Error(`The sign-in page redirected without a location (${current}).`);
      current = new URL(location, current);
      response = await router.request(current);
      continue;
    }
    if (response.status >= 400)
      throw new Error(
        `The sign-in page ${current} answered ${response.status}: ${response.body.slice(0, 300)}`,
      );
    const location = response.headers['content-type'] ?? '';
    if (!String(location).includes('text/html')) return current;
    const form = chooseForm(parseForms(response.body, current));
    if (!form) return current;
    const submitted = formBody(form, signIn, current);
    current = new URL(submitted.action);
    response = await router.request(current, {
      method: 'POST',
      body: submitted.body,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html,application/xhtml+xml',
      },
    });
  }
  throw new Error(`The sign-in did not finish after ${limit} steps (last page ${current}).`);
}

export async function connectMcpApp(options: {
  otto: Otto;
  slug: Extract<GymApp, 'notion' | 'linear'>;
  router: OAuthRouter;
  signIn: SignIn;
}) {
  const started = await options.otto.request('POST', `/api/apps/${options.slug}/connect`, {});
  const url = typeof started.url === 'string' ? started.url : '';
  if (!url) throw new Error(`Otto did not offer a ${options.slug} sign-in link.`);
  const ended = await completeOAuth(url, options.signIn, options.router);
  const apps = await options.otto.apps();
  const app = apps.find((entry) => entry.slug === options.slug && entry.status === 'connected');
  if (!app)
    throw new Error(`The ${options.slug} sign-in ended at ${ended} without connecting the app.`);
  return app;
}

export function createOAuthRouter(options: {
  vendors: Record<string, number>;
  ottoPort: number;
  ca: string;
}): OAuthRouter {
  return {
    request(url, request = {}) {
      const method = request.method ?? 'GET';
      const body = request.body;
      const headers: Record<string, string> = {
        host: url.host,
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'user-agent': 'otto-gym',
        ...(body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) }),
        ...request.headers,
      };
      if (url.protocol === 'http:')
        return new Promise((resolve, reject) => {
          const outgoing = httpRequest(
            {
              hostname: '127.0.0.1',
              port: options.ottoPort,
              path: `${url.pathname}${url.search}`,
              method,
              headers,
            },
            (incoming) => {
              collect(incoming).then(
                (response) => resolve({ ...response, headers: incoming.headers }),
                reject,
              );
            },
          );
          outgoing.on('error', reject);
          outgoing.end(body);
        });
      const port = options.vendors[url.hostname];
      if (!port) return Promise.reject(new Error(`The gym does not route ${url.hostname}.`));
      return new Promise((resolve, reject) => {
        const outgoing = httpsRequest(
          {
            hostname: '127.0.0.1',
            port,
            servername: url.hostname,
            path: `${url.pathname}${url.search}`,
            method,
            headers,
            ca: options.ca,
            rejectUnauthorized: true,
          },
          (incoming) => {
            collect(incoming).then(
              (response) => resolve({ ...response, headers: incoming.headers }),
              reject,
            );
          },
        );
        outgoing.on('error', reject);
        outgoing.end(body);
      });
    },
  };
}

function collect(incoming: import('node:http').IncomingMessage) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('error', reject);
    incoming.on('end', () =>
      resolve({
        status: incoming.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }),
    );
  });
}
