import { useEffect, useRef, useState } from 'react';
import type { ChannelProvider } from '../../../../shared/contracts';
import type { StepProps } from '..';
import { Rise } from '../../../components/motion';
import { TelegramSetup } from '../../../components/telegram-setup';
import { WhatsAppSetup } from '../../../components/whatsapp-setup';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Notice,
} from '../../../components/ui';
import { telegramState, useChannelSettings } from '../../../hooks/use-channel-settings';
import { channelSetupBody, telegramBotUrl } from '../../../lib/secondary-pages';
import { Bubble, Footer, Messages, useReveal } from '../motion';

const sequence = [{ typing: 450 }, { wait: 300, typing: 550 }, { wait: 200 }, { wait: 300 }];
const providers = [
  { id: 'telegram' as const, name: 'Telegram', description: 'Connect your own Telegram bot.' },
  {
    id: 'whatsapp' as const,
    name: 'WhatsApp',
    description: 'Link your own number with a QR code.',
  },
];

export function Messaging({ arrived, onNext, onBack, onSkip, nextLabel }: StepProps) {
  const { revealed, typing, done, skip } = useReveal(sequence, {
    enabled: arrived === 'forward',
  });
  const [editing, setEditing] = useState<ChannelProvider>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [manual, setManual] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const keepChannel = useRef<HTMLButtonElement>(null);
  const issued = useRef(false);
  const {
    settings,
    telegram,
    error,
    setError,
    loadError,
    loading,
    busy,
    pairingUrl,
    load,
    save,
    remove,
    telegramAction,
  } = useChannelSettings({
    watchTelegram: editing === 'telegram',
    watchWhatsApp: editing === 'whatsapp',
  });
  const whatsapp = settings?.channels.find((item) => item.provider === 'whatsapp');
  const telegramStatus = telegramState(telegram);
  const whatsappReady = Boolean(
    whatsapp?.enabled &&
    (whatsapp.mode === 'linked'
      ? whatsapp.connectionState === 'connected'
      : whatsapp.webhookStatus === 'registered'),
  );
  const connected = telegramStatus.paired || whatsappReady;
  const selected = editing === 'telegram' ? telegram : whatsapp;
  const selectedName = editing === 'telegram' ? 'Telegram' : 'WhatsApp';
  const existingWhatsApp = Boolean(
    whatsapp?.enabled && (whatsapp.mode !== 'linked' || whatsapp.linkMode !== 'self-chat'),
  );
  const telegramUrl = telegramBotUrl(telegram?.accountHandle);

  useEffect(() => {
    if (
      editing !== 'telegram' ||
      !settings?.ready ||
      issued.current ||
      !telegramStatus.ready ||
      telegramStatus.paired ||
      pairingUrl ||
      telegramStatus.waiting
    )
      return;
    issued.current = true;
    void telegramAction('pairing');
  }, [
    editing,
    settings,
    telegramStatus.ready,
    telegramStatus.paired,
    telegramStatus.waiting,
    pairingUrl,
  ]);

  useEffect(() => {
    if (removing) keepChannel.current?.focus({ preventScroll: true });
  }, [removing]);

  function close() {
    setEditing(undefined);
    setFields({});
    setError('');
    setManual(false);
    setRemoving(false);
    setRemoveError('');
  }

  function open(provider: ChannelProvider) {
    issued.current = false;
    setFields({});
    setManual(false);
    setError('');
    setRemoving(false);
    setRemoveError('');
    setEditing(provider);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (editing !== 'telegram' || busy || !settings?.ready) return;
    issued.current = true;
    const result = await save('telegram', channelSetupBody('telegram', fields, false));
    if (result.ok || result.channel?.enabled) setFields({});
  }

  async function action(kind: 'pairing' | 'confirm' | 'user', body: object = {}) {
    if (busy || !settings?.ready || !(await telegramAction(kind, body))) return;
    setManual(false);
    setFields({});
  }

  async function disconnect() {
    if (!editing || busy) return;
    setRemoveError('');
    const failure = await remove(editing);
    if (failure === '') close();
    else if (failure) setRemoveError(failure);
  }

  return (
    <section className="ob-step ob-messaging" onClick={done ? undefined : skip}>
      <div data-analytics-public>
        <Messages
          revealed={revealed}
          typing={typing}
          items={[
            <Bubble>Take nod with you.</Bubble>,
            <Bubble>
              Send me a task from your phone and pick up the same conversation here. Keep nod
              running on your computer so I can reply.
            </Bubble>,
          ]}
        />
      </div>
      <Rise show={revealed >= 3} className="ob-messaging-options">
        {providers.map((provider) => {
          const setup = provider.id === 'telegram' ? telegram : whatsapp;
          const identity = setup?.enabled ? setup.accountHandle || setup.accountName : undefined;
          return (
            <div className="ob-messaging-card" key={provider.id}>
              <img src={`/logos/${provider.id}.svg`} alt="" width={24} height={24} />
              <div>
                <h2>{provider.name}</h2>
                <p data-analytics-private={identity ? true : undefined}>
                  {identity || provider.description}
                </p>
              </div>
              <Button
                variant={setup?.enabled ? 'ghost' : 'outline'}
                size="sm"
                disabled={busy || !settings?.ready}
                onClick={() => open(provider.id)}
              >
                {setup?.enabled ? 'Manage' : 'Connect'}
              </Button>
            </div>
          );
        })}
        {loadError && (
          <Notice>
            {loadError}{' '}
            <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
              Try again
            </Button>
          </Notice>
        )}
      </Rise>
      <Footer
        show={revealed >= 4}
        onBack={onBack}
        onSkip={
          connected
            ? undefined
            : () => {
                onSkip?.();
                onNext();
              }
        }
        onNext={onNext}
        nextDisabled={!connected}
        nextLabel={nextLabel}
      />
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(value) => {
          if (!value && !busy) close();
        }}
      >
        <DialogContent className="channel-wizard" aria-busy={busy}>
          <div className="channel-wizard-heading">
            <img src={`/logos/${editing ?? 'telegram'}.svg`} alt="" width={24} height={24} />
            <span>{selectedName}</span>
          </div>
          <DialogTitle>
            {selected?.enabled ? `Your ${selectedName} connection` : `Connect ${selectedName}`}
          </DialogTitle>
          <DialogDescription>
            {selected?.enabled
              ? 'Keep nod running on your computer to receive messages.'
              : editing === 'telegram'
                ? 'Create a bot, then link your Telegram account.'
                : 'Link your own number, then use Message yourself to talk to nod.'}
          </DialogDescription>
          {editing === 'telegram' && telegramStatus.paired ? (
            <div className="channel-wizard-step" data-analytics-private>
              <div className="ob-messaging-identity">
                <strong>
                  {telegram?.accountName || telegram?.accountHandle || 'Your Telegram bot'}
                </strong>
                {telegram?.accountHandle && <span>{telegram.accountHandle}</span>}
              </div>
              <p>
                Only {telegram?.pairedUser || telegram?.pairedUsername || telegram?.allowedUserId}{' '}
                can message nod through this bot.
              </p>
              <div className="channel-wizard-actions">
                <Button variant="ghost" disabled={busy} onClick={() => setRemoving(true)}>
                  Disconnect
                </Button>
                {telegramUrl && (
                  <Button asChild variant="outline">
                    <a href={telegramUrl} target="_blank" rel="noopener noreferrer">
                      Open Telegram
                    </a>
                  </Button>
                )}
                <Button onClick={close}>Done</Button>
              </div>
            </div>
          ) : editing === 'telegram' ? (
            <>
              <TelegramSetup
                setup={telegram}
                pairingUrl={pairingUrl}
                manual={manual}
                fields={fields}
                busy={busy}
                error={error || loadError}
                unavailable={!settings?.ready}
                allowWebhook
                onField={(name, value) => setFields((current) => ({ ...current, [name]: value }))}
                onVerify={(event) => void submit(event)}
                onConfirm={() => void action('confirm')}
                onNewLink={() => void action('pairing')}
                onManual={setManual}
                onSaveId={(event) => {
                  event.preventDefault();
                  void action('user', { allowedUserId: fields.allowedUserId?.trim() });
                }}
              />
              <div className="channel-wizard-actions">
                {telegram?.enabled && (
                  <Button variant="ghost" disabled={busy} onClick={() => setRemoving(true)}>
                    Disconnect
                  </Button>
                )}
                <Button variant="ghost" disabled={busy} onClick={close}>
                  Close
                </Button>
              </div>
            </>
          ) : existingWhatsApp ? (
            <div className="channel-wizard-step" data-analytics-private>
              <div className="ob-messaging-identity">
                <strong>{whatsapp?.accountName || 'Your WhatsApp account'}</strong>
                {whatsapp?.accountHandle && <span>{whatsapp.accountHandle}</span>}
              </div>
              <p>
                {whatsapp?.mode === 'linked'
                  ? 'Your separate bot number'
                  : 'Your WhatsApp Business account'}{' '}
                is already saved. You can manage its settings in Channels after setup.
              </p>
              <p>To link your own number here, disconnect this account first.</p>
              <div className="channel-wizard-actions">
                <Button variant="ghost" disabled={busy} onClick={() => setRemoving(true)}>
                  Disconnect
                </Button>
                <Button onClick={close}>Done</Button>
              </div>
            </div>
          ) : (
            <WhatsAppSetup
              setup={whatsapp}
              busy={busy}
              ready={Boolean(settings?.ready)}
              error={error || loadError}
              selfChatOnly
              onSave={async (input) => (await save('whatsapp', input)).ok}
              onRefresh={load}
              onDisconnect={() => setRemoving(true)}
              onDone={close}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={removing}
        onOpenChange={(value) => {
          if (!value && !busy) setRemoving(false);
        }}
      >
        <DialogContent className="channel-remove-dialog" aria-busy={busy}>
          <DialogTitle>Disconnect {selectedName}?</DialogTitle>
          <DialogDescription>
            nod will stop receiving messages here. You can connect again later.
          </DialogDescription>
          <div className="channel-wizard-step" data-analytics-private>
            {selected?.accountHandle && <p>{selected.accountHandle}</p>}
            {removeError && <Notice>{removeError}</Notice>}
            <div className="channel-wizard-actions">
              <Button
                ref={keepChannel}
                variant="outline"
                disabled={busy}
                onClick={() => setRemoving(false)}
              >
                Keep connected
              </Button>
              <Button variant="destructive" disabled={busy} onClick={() => void disconnect()}>
                {busy ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
