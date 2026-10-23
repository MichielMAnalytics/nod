import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { LoaderCircle } from '../../../components/icons';
import type { AppSetupStatus, Configuration, Connection } from '../../../../shared/contracts';
import { onboardingEmailProviders } from '../../../../shared/onboarding';
import { ServiceLogo } from '../../../components/service-logo';
import { Rise } from '../../../components/motion';
import { Button } from '../../../components/ui';
import { usePageData } from '../../../hooks/use-page-data';
import { api, errorMessage } from '../../../lib/api';
import { analyticsForCurrentSession } from '../../../lib/analytics';
import { connectionUrl } from '../../../lib/connection-url';
import { desktopLinksAvailable, openConnection } from '../../../lib/desktop';
import type { StepProps } from '..';
import { Bubble, Footer, Messages, useReveal, type RevealStep } from '../motion';

const sequence: RevealStep[] = [{ typing: 450 }, { wait: 200 }, { wait: 200 }];

const outcomes = ['connected', 'cancelled', 'failed', 'expired'];

type EmailProvider = (typeof onboardingEmailProviders)[number];
const providerNames: Record<EmailProvider, string> = { gmail: 'Gmail', outlook: 'Outlook' };

function ownedAccount(connection: Connection) {
  return (
    connection.status === 'connected' &&
    Boolean(connection.connectionId && connection.accountId) &&
    !connection.disconnectPending
  );
}

function connectionMessage(service: EmailProvider, result?: string) {
  if (result === 'cancelled') return 'Sign-in cancelled. You can try again.';
  if (result === 'failed' || result === 'expired')
    return `${providerNames[service]} didn’t connect. Try again?`;
  return '';
}

export function Email({ arrived, onNext, onBack, onSkip }: StepProps) {
  const { revealed, typing, done, skip } = useReveal(sequence, {
    enabled: arrived === 'forward',
  });
  const configuration = usePageData<Configuration>('/api/configuration');
  const apps = usePageData<Connection[]>('/api/apps');
  const catalog = usePageData<Connection[]>('/api/apps/catalog');
  const refreshApps = apps.refresh;
  const [reloading, setReloading] = useState(false);
  const [recovering, setRecovering] = useState<string>();
  const [pending, setPending] = useState<'opening' | 'waiting'>();
  const [pairingConfirmed, setPairingConfirmed] = useState(false);
  const [signInUrl, setSignInUrl] = useState<string>();
  const [stale, setStale] = useState(false);
  const [pollFailing, setPollFailing] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<EmailProvider>();
  const [provider, setProvider] = useState<EmailProvider>();
  const request = useRef<AbortController | null>(null);
  const attempt = useRef<{ id: string; service: EmailProvider } | undefined>(undefined);
  const active = useRef(false);

  function clearAttempt() {
    setCompleted(undefined);
    attempt.current = undefined;
    setSignInUrl(undefined);
    setStale(false);
    setPollFailing(false);
  }

  useEffect(() => {
    active.current = true;
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('nod.apps');
    if (channel)
      channel.onmessage = (
        event: MessageEvent<{ connection?: string; service?: string; attempt?: string } | null>,
      ) => {
        const { connection, service, attempt: value } = event.data ?? {};
        if (
          !attempt.current ||
          service !== attempt.current.service ||
          !value ||
          attempt.current.id !== value ||
          !outcomes.includes(connection ?? '')
        )
          return;
        const selected = attempt.current.service;
        clearAttempt();
        setCompleted(connection === 'connected' ? selected : undefined);
        setError(connectionMessage(selected, connection));
        setPending((current) => (current === 'waiting' ? undefined : current));
        void refreshApps();
      };
    return () => {
      active.current = false;
      channel?.close();
      request.current?.abort();
      attempt.current = undefined;
    };
  }, []);

  useEffect(() => {
    const currentAttempt = attempt.current;
    if (!signInUrl || !currentAttempt) return;
    const controller = new AbortController();
    let checking: Promise<boolean> | undefined;
    let poll: number | undefined;
    let grace: number | undefined;
    let failures = 0;
    let confirmed = false;
    const current = () => !controller.signal.aborted && attempt.current === currentAttempt;
    const settle = (result: 'connected' | 'failed' | 'expired') => {
      if (!current()) return;
      controller.abort();
      window.clearTimeout(poll);
      window.clearTimeout(grace);
      clearAttempt();
      setCompleted(result === 'connected' ? currentAttempt.service : undefined);
      setPending(undefined);
      setError(connectionMessage(currentAttempt.service, result));
      void refreshApps();
    };
    const read = async () => {
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signInUrl));
        const hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        const result = await api<AppSetupStatus>('/api/apps/setup-status', {
          method: 'POST',
          body: JSON.stringify({ hashes: [hash], pairingUrl: signInUrl }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          cache: 'no-store',
        });
        if (!current()) return false;
        failures = 0;
        setPollFailing(false);
        if (result.completed.includes(hash)) {
          settle('connected');
          return true;
        }
        const app = result.apps.find((app) => app.hash === hash);
        if (!app) {
          settle('failed');
          return true;
        }
        if (app.pairingConfirmed === true && !confirmed) {
          confirmed = true;
          setPairingConfirmed(true);
        }
      } catch {
        if (current() && ++failures >= 3) setPollFailing(true);
      }
      return false;
    };
    const check = () => {
      if (!current()) return Promise.resolve(false);
      checking ??= read().finally(() => {
        checking = undefined;
      });
      return checking;
    };
    const schedule = () => {
      poll = window.setTimeout(() => {
        void check().finally(() => {
          if (current()) schedule();
        });
      }, 5000);
    };
    const returned = () => {
      if (document.visibilityState !== 'visible') return;
      void check();
      window.clearTimeout(grace);
      grace = window.setTimeout(() => {
        if (current()) setStale(true);
      }, 4000);
    };
    if (document.visibilityState === 'visible') void check();
    schedule();
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', returned);
    const timer = window.setTimeout(() => {
      void check().then((settled) => {
        if (!settled) settle('expired');
      });
    }, 10 * 60_000);
    return () => {
      controller.abort();
      window.clearTimeout(poll);
      window.clearTimeout(grace);
      window.clearTimeout(timer);
      window.removeEventListener('focus', returned);
      document.removeEventListener('visibilitychange', returned);
    };
  }, [signInUrl, provider, refreshApps]);

  const providers = onboardingEmailProviders.map((slug) => {
    const accounts = apps.data?.filter((connection) => connection.slug === slug) ?? [];
    const service =
      catalog.data?.find((connection) => connection.slug === slug) ??
      accounts.find((connection) => connection.status !== 'not_configured');
    return {
      slug,
      service,
      account: accounts.find(ownedAccount),
      disconnections: accounts.filter((connection) => connection.disconnectPending),
    };
  });
  const connected = providers.some((entry) => entry.account);
  const loading = (!configuration.data && !configuration.error) || (!apps.data && !apps.error);
  const unavailable = loading
    ? ''
    : !configuration.data || !apps.data
      ? 'Couldn’t check your app connections.'
      : !configuration.data.integrationsReady
        ? 'Email connections aren’t available right now.'
        : '';
  const canConnect = (slug: EmailProvider) => {
    const entry = providers.find((item) => item.slug === slug)!;
    return (
      !entry.disconnections.length &&
      !recovering &&
      !loading &&
      !unavailable &&
      Boolean(entry.service && entry.service.status !== 'not_configured')
    );
  };
  const confirmed = completed && providers.find((entry) => entry.slug === completed)?.account;
  const ready = Boolean(completed && canConnect(completed));

  useEffect(() => {
    if (
      arrived !== 'forward' ||
      !completed ||
      !confirmed ||
      !ready ||
      pending ||
      apps.refreshing ||
      apps.error
    )
      return;
    setCompleted(undefined);
    onNext();
  }, [arrived, completed, confirmed, ready, pending, apps.refreshing, apps.error, onNext]);

  async function connect(slug: EmailProvider) {
    if (request.current || !canConnect(slug)) return;
    const capture = analyticsForCurrentSession();
    capture('nod_app_connect_clicked', { entry: 'onboarding', result: 'opened' });
    const external = desktopLinksAvailable();
    const popup = external
      ? null
      : window.open(
          `/connection-loading.html?service=${slug}`,
          `nod-connect-${slug}`,
          'popup,width=520,height=720',
        );
    try {
      if (popup) popup.opener = null;
    } catch {}
    const controller = new AbortController();
    request.current = controller;
    controller.signal.addEventListener('abort', () => popup?.close(), { once: true });
    clearAttempt();
    setProvider(slug);
    setPending('opening');
    setPairingConfirmed(false);
    setError('');
    let next: 'waiting' | undefined;
    try {
      const response = await api<{ url: string; attempt?: string }>(`/api/apps/${slug}/connect`, {
        method: 'POST',
        body: JSON.stringify({ returnTo: 'window' }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new DOMException('Cancelled.', 'AbortError');
      const url = connectionUrl(response.url, window.location.origin);
      if (!response.attempt || !/^[A-Za-z0-9_-]{43}$/.test(response.attempt))
        throw new Error(connectionMessage(slug, 'failed'));
      attempt.current = { id: response.attempt, service: slug };
      flushSync(() => {
        setSignInUrl(url);
      });
      next = 'waiting';
      if (external) await openConnection(url);
      else if (popup && !popup.closed) popup.location.href = url;
    } catch (cause) {
      popup?.close();
      if (controller.signal.aborted || request.current !== controller) return;
      clearAttempt();
      setError(errorMessage(cause));
      capture('nod_ui_error', { area: 'onboarding', action: 'connect' });
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (active.current) setPending(attempt.current ? next : undefined);
      }
    }
  }

  async function retryDisconnection(connection: Connection) {
    const id = connection.connectionId!;
    if (request.current || recovering) return;
    const controller = new AbortController();
    request.current = controller;
    setRecovering(id);
    setError('');
    try {
      await api(
        `/api/apps/${encodeURIComponent(connection.slug)}/accounts/${encodeURIComponent(id)}/disconnect`,
        {
          method: 'POST',
          signal: controller.signal,
        },
      );
      await refreshApps();
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (request.current === controller) request.current = null;
      if (active.current) setRecovering(undefined);
    }
  }

  function cancel() {
    request.current?.abort();
    request.current = null;
    clearAttempt();
    setPending(undefined);
  }

  async function reload() {
    setReloading(true);
    await Promise.all([configuration.refresh(), refreshApps(), catalog.refresh()]);
    if (active.current) setReloading(false);
  }

  return (
    <section className="ob-step ob-email" data-analytics-public onClick={done ? undefined : skip}>
      <Messages
        revealed={revealed}
        typing={typing}
        items={[<Bubble>Let’s connect your email.</Bubble>]}
      />
      <Rise show={revealed >= 2} className="ob-email-choices">
        <p className="ob-email-benefits">
          Catch up on important emails and get help drafting replies.
        </p>
        <div className="ob-email-providers">
          {providers.map(({ slug, service, account, disconnections: issues }) => (
            <div
              className="ob-email-provider"
              key={slug}
              data-provider={slug}
              data-connected={Boolean(account)}
            >
              <ServiceLogo slug={slug} logoUrl={service?.logoUrl} size={28} />
              <div className="ob-email-identity">
                <span>{providerNames[slug]}</span>
                {account?.accountEmail && (
                  <span className="ob-email-muted" data-analytics-private>
                    {account.accountEmail}
                  </span>
                )}
                {!loading &&
                  !catalog.loading &&
                  (!service || service.status === 'not_configured') &&
                  !unavailable && <span className="ob-email-muted">Unavailable right now</span>}
              </div>
              {account ? (
                <span className="ob-email-connected">Connected</span>
              ) : pending && provider === slug ? (
                <Button variant="ghost" size="sm" onClick={cancel}>
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Connect ${providerNames[slug]}`}
                  disabled={!canConnect(slug) || Boolean(pending)}
                  onClick={() => void connect(slug)}
                >
                  Connect
                </Button>
              )}
              {issues.map((connection) => (
                <div
                  className="ob-email-retry"
                  key={connection.connectionId ?? connection.accountId}
                >
                  <p>Disconnection wasn’t confirmed.</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={Boolean(recovering || pending || !connection.connectionId)}
                    onClick={() => void retryDisconnection(connection)}
                  >
                    {recovering === connection.connectionId ? 'Checking…' : 'Retry disconnection'}
                  </Button>
                </div>
              ))}
            </div>
          ))}
        </div>
        {pending && (
          <div className="ob-email-waiting" role="status">
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
            <p>
              {pending === 'opening'
                ? 'Opening sign-in…'
                : stale
                  ? 'Didn’t finish signing in?'
                  : 'Finish signing in in your browser.'}
            </p>
            {signInUrl && !pairingConfirmed && (
              <a href={signInUrl} target="_blank" rel="noreferrer">
                Open sign-in
              </a>
            )}
            {stale && provider && (
              <Button variant="ghost" size="sm" onClick={() => void connect(provider)}>
                Start again
              </Button>
            )}
          </div>
        )}
        {(unavailable || (!loading && catalog.error)) && (
          <div className="ob-email-retry">
            <p className="ob-email-muted">{unavailable || 'Couldn’t load all email providers.'}</p>
            <Button variant="ghost" size="sm" disabled={reloading} onClick={() => void reload()}>
              Try again
            </Button>
          </div>
        )}
        {pollFailing && (
          <p role="alert" className="ob-email-error">
            Can’t check sign-in right now. Still trying.
          </p>
        )}
        {error && (
          <p role="alert" className="ob-email-error" data-analytics-private>
            {error}
          </p>
        )}
      </Rise>
      <Footer
        show={revealed >= 3}
        onBack={onBack}
        onNext={onNext}
        onSkip={
          connected
            ? undefined
            : () => {
                cancel();
                onSkip?.();
                onNext();
              }
        }
        nextDisabled={!connected || Boolean(pending || recovering)}
      />
    </section>
  );
}
