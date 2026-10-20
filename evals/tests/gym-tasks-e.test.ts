import assert from 'node:assert/strict';
import test from 'node:test';
import type { Check, Evidence, Expected } from '../gym/evidence.ts';
import { task11Checks } from '../gym/tasks/11-double-booked-day.ts';
import { task13Checks } from '../gym/tasks/13-receipt-photo.ts';
import { task15Checks } from '../gym/tasks/15-customer-feedback-report.ts';

const expected: Expected = {
  currency: 'GBP',
  transactions: 0,
  openingBalance: 0,
  closingBalance: 0,
  netCashMovement: 0,
  revenue: 0,
  operatingExpenses: 0,
  netProfit: 0,
  netProfitIncludingVat: 0,
  netProfitNote: '',
  vatPaid: 0,
  drawings: 0,
  loanPrincipal: 0,
  tolerance: 1,
};

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    task: 'gym',
    expected,
    transactions: [],
    hosts: [{ host: 'backend.composio.dev', ok: true }],
    apps: [],
    message: { turnId: 'turn-1' },
    turn: { status: 'succeeded', seconds: 30, timedOut: false, limitSeconds: 1200 },
    toolCalls: [],
    google: { tenant: 'synthetic', now: '2026-10-01T00:00:00Z' },
    driveBefore: [],
    workspace: { files: [] },
    confirmations: [],
    appWrites: [],
    approvals: [],
    ...overrides,
  };
}

function check(checks: Check[], id: string) {
  const found = checks.find((item) => item.id === id);
  assert.ok(found, `missing check ${id}`);
  return found;
}

interface Event {
  calendar_id?: string;
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: Array<{ email?: string }>;
  organizer?: string;
  ref?: string;
}

const owner = 'ada@acme.test';

function event(
  id: string,
  ref: string,
  summary: string,
  start: string,
  end: string,
  attendees: string[],
  organizer = owner,
): Event {
  return {
    calendar_id: organizer,
    id,
    status: 'confirmed',
    summary,
    start: { dateTime: `${start}+01:00` },
    end: { dateTime: `${end}+01:00` },
    attendees: attendees.map((email) => ({ email })),
    organizer,
    ref,
  };
}

function calendarEvents(): Event[] {
  return [
    event(
      'e-customer',
      'event:customer-call',
      'Customer call — Northwind',
      '2026-10-15T10:00:00',
      '2026-10-15T10:30:00',
      [owner, 'omar@northwind.test'],
    ),
    event(
      'e-jo',
      'event:one-on-one-jo',
      '1:1 with Jo',
      '2026-10-15T10:00:00',
      '2026-10-15T10:30:00',
      [owner, 'jo@acme.test'],
    ),
    event(
      'e-standup',
      'event:standup',
      'Team standup',
      '2026-10-15T09:00:00',
      '2026-10-15T09:30:00',
      [owner, 'priya@acme.test'],
    ),
    event(
      'e-design',
      'event:design-review',
      'Design review',
      '2026-10-15T11:30:00',
      '2026-10-15T12:30:00',
      [owner, 'priya@acme.test'],
    ),
    event(
      'e-team',
      'event:team-meeting',
      'Team meeting',
      '2026-10-15T15:00:00',
      '2026-10-15T16:00:00',
      [owner, 'priya@acme.test'],
    ),
    event(
      'e-sam',
      'event:one-on-one-sam',
      '1:1 with Sam',
      '2026-10-15T15:00:00',
      '2026-10-15T15:30:00',
      [owner, 'sam@acme.test'],
    ),
    event('e-retro', 'event:retro', 'Weekly retro', '2026-10-15T17:00:00', '2026-10-15T17:30:00', [
      owner,
      'priya@acme.test',
    ]),
    event(
      'e-jo-onb',
      'event:jo-onboarding',
      'Customer onboarding — Globex',
      '2026-10-15T14:00:00',
      '2026-10-15T15:00:00',
      ['jo@acme.test'],
      'jo@acme.test',
    ),
    event(
      'e-jo-pipe',
      'event:jo-pipeline',
      'Pipeline review',
      '2026-10-15T16:00:00',
      '2026-10-15T17:00:00',
      ['jo@acme.test', 'ken@acme.test'],
      'jo@acme.test',
    ),
    event(
      'e-sam-hand',
      'event:sam-handover',
      'On-call handover',
      '2026-10-15T11:00:00',
      '2026-10-15T12:00:00',
      ['sam@acme.test', 'priya@acme.test'],
      'sam@acme.test',
    ),
    event(
      'e-sam-hire',
      'event:sam-hiring',
      'Hiring panel',
      '2026-10-15T16:00:00',
      '2026-10-15T17:00:00',
      ['sam@acme.test', 'priya@acme.test'],
      'sam@acme.test',
    ),
  ];
}

function moved(events: Event[], id: string, start: string, end: string) {
  return events.map((item) =>
    item.id === id
      ? { ...item, start: { dateTime: `${start}+01:00` }, end: { dateTime: `${end}+01:00` } }
      : item,
  );
}

function mailboxes(messages: Array<{ id: string; to: string; sent?: boolean }>) {
  return [
    {
      email: owner,
      messages: messages.map((message) => ({
        id: message.id,
        to: message.to,
        labelIds: message.sent ? ['SENT'] : ['INBOX'],
        labels: message.sent ? ['SENT'] : ['INBOX'],
      })),
    },
  ];
}

function movedDefaults() {
  return moved(
    moved(calendarEvents(), 'e-jo', '2026-10-15T10:30:00', '2026-10-15T11:00:00'),
    'e-sam',
    '2026-10-15T17:30:00',
    '2026-10-15T18:00:00',
  );
}

function eleven(
  options: {
    events?: Event[];
    mailboxes?: Array<{ id: string; to: string; sent?: boolean }>;
  } = {},
): Evidence {
  return evidence({
    task: 'gym-11',
    initial: {
      google: { events: calendarEvents(), mailboxes: mailboxes([{ id: 'm1', to: owner }]) },
    },
    google: {
      tenant: 'synthetic',
      now: '2026-10-01T00:00:00Z',
      events: options.events ?? movedDefaults(),
      mailboxes: mailboxes(
        options.mailboxes ?? [
          { id: 'm1', to: owner },
          { id: 'm2', to: 'Jo <jo@acme.test>', sent: true },
          { id: 'm3', to: 'sam@acme.test', sent: true },
        ],
      ),
    },
  });
}

test('double-booked day passes when both 1:1s sit in free slots and everyone was told', () => {
  const checks = task11Checks(eleven());
  assert.equal(check(checks, 'one-on-ones-rescheduled').pass, true);
  assert.equal(
    check(checks, 'one-on-ones-rescheduled').message,
    'The 1:1s were moved into free slots: the 1:1 with Jo to 10:30 and the 1:1 with Sam to 17:30.',
  );
  assert.equal(check(checks, 'people-told').pass, true);
  assert.equal(
    check(checks, 'people-told').message,
    'Jo and Sam were each sent a message about the new time.',
  );
  assert.equal(check(checks, 'customer-and-team-meeting-unchanged').pass, true);
  assert.equal(check(checks, 'no-other-event-changed').pass, true);
  assert.equal(
    check(checks, 'no-other-event-changed').message,
    'No other calendar event was changed (11 events checked).',
  );
});

test('double-booked day reports a slot where the person is busy', () => {
  const clashing = moved(movedDefaults(), 'e-sam', '2026-10-15T16:00:00', '2026-10-15T16:30:00');
  const found = check(task11Checks(eleven({ events: clashing })), 'one-on-ones-rescheduled');
  assert.equal(found.pass, false);
  assert.equal(
    found.message,
    'The 1:1 with Sam was moved to 16:00, when Sam is busy (Hiring panel).',
  );
});

test('double-booked day reports a 1:1 left where it was', () => {
  const untouched = moved(calendarEvents(), 'e-sam', '2026-10-15T17:30:00', '2026-10-15T18:00:00');
  const result = task11Checks(eleven({ events: untouched }));
  assert.equal(
    check(result, 'one-on-ones-rescheduled').message,
    'The 1:1 with Jo is still at 10:00, when the calendar is double-booked.',
  );
});

test('double-booked day reports who was not told', () => {
  const result = task11Checks(
    eleven({
      mailboxes: [
        { id: 'm1', to: owner },
        { id: 'm2', to: 'jo@acme.test', sent: true },
      ],
    }),
  );
  const found = check(result, 'people-told');
  assert.equal(found.pass, false);
  assert.equal(found.message, "Sam wasn't told: the event was moved and no message was sent.");
});

test('double-booked day fails when a customer meeting moved', () => {
  const shifted = moved(
    movedDefaults(),
    'e-customer',
    '2026-10-15T13:00:00',
    '2026-10-15T13:30:00',
  );
  const result = task11Checks(eleven({ events: shifted }));
  assert.equal(
    check(result, 'customer-and-team-meeting-unchanged').message,
    'Otto changed the customer call with Northwind.',
  );
});

test('double-booked day names the other event Otto changed', () => {
  const shifted = moved(movedDefaults(), 'e-standup', '2026-10-15T09:30:00', '2026-10-15T10:00:00');
  const result = task11Checks(eleven({ events: shifted }));
  assert.equal(
    check(result, 'no-other-event-changed').message,
    'Otto also changed Team standup (event:standup).',
  );
});

const receipt = {
  date: '2026-10-14',
  merchant: 'City Cabs',
  fare: 18,
  tip: 3.8,
  amount: 21.8,
  currency: 'GBP',
};

const expenseRows: unknown[][] = [
  ['Date', 'Merchant', 'Category', 'Amount'],
  ['2026-09-25', 'Pret A Manger', 'Meals', 12.4],
  ['2026-09-27', 'Uber', 'Travel', 24.5],
  ['2026-09-29', 'Hotel Lux', 'Accommodation', 241.5],
  ['2026-10-01', 'Trainline', 'Travel', 58.2],
  ['2026-10-05', 'Ryman', 'Office', 33.15],
  ['2026-10-08', 'Adobe', 'Software', 49.99],
];

function expenseSheet(rows: unknown[][]) {
  return {
    spreadsheets: [
      {
        spreadsheetId: 'sheet-1',
        title: 'October expenses',
        ref: 'sheet:october-expenses',
        sheets: [{ sheetId: 1, title: 'Expenses', rows }],
      },
    ],
  };
}

function thirteen(overrides: Partial<Evidence> = {}): Evidence {
  return evidence({
    task: 'gym-13',
    message: { messageId: 5, channel: 'web' },
    initial: { google: expenseSheet(expenseRows) },
    google: {
      tenant: 'synthetic',
      now: '2026-10-01T00:00:00Z',
      ...expenseSheet([...expenseRows, ['2026-10-14', 'City Cabs', 'Travel', 21.8]]),
    },
    messages: [
      {
        text: 'Added the City Cabs taxi, £21.80, to October expenses.',
        turnId: 'turn-1',
      },
    ],
    recorded: { receipt },
    ...overrides,
  });
}

test("receipt photo passes with one matching row in Otto's app", () => {
  const checks = task13Checks(thirteen());
  assert.equal(check(checks, 'one-row-appended').pass, true);
  assert.equal(
    check(checks, 'one-row-appended').message,
    'Otto added one row to the October expenses sheet: 2026-10-14, City Cabs, Travel, 21.8.',
  );
  assert.equal(check(checks, 'row-matches-receipt').pass, true);
  assert.equal(
    check(checks, 'row-matches-receipt').message,
    'The new row says 2026-10-14, City Cabs, £21.80.',
  );
  assert.equal(check(checks, 'confirmed').pass, true);
  assert.equal(
    check(checks, 'confirmed').message,
    'Otto confirmed: "Added the City Cabs taxi, £21.80, to October expenses.".',
  );
  assert.equal(check(checks, 'no-other-rows-changed').pass, true);
});

test('receipt photo accepts the date as a Sheets date serial', () => {
  const result = task13Checks(
    thirteen({
      google: {
        tenant: 'synthetic',
        now: '2026-10-01T00:00:00Z',
        ...expenseSheet([...expenseRows, [46309, 'City Cabs', 'Travel', 21.8]]),
      },
    }),
  );
  assert.equal(check(result, 'row-matches-receipt').pass, true);
});

test('receipt photo reports the amount the new row carries', () => {
  const result = task13Checks(
    thirteen({
      google: {
        tenant: 'synthetic',
        now: '2026-10-01T00:00:00Z',
        ...expenseSheet([...expenseRows, ['2026-10-14', 'City Cabs', 'Travel', 18.5]]),
      },
    }),
  );
  const found = check(result, 'row-matches-receipt');
  assert.equal(found.pass, false);
  assert.equal(found.message, 'The new row says £18.50; the receipt total is £21.80.');
});

test('receipt photo reports a row with the wrong merchant and date', () => {
  const result = task13Checks(
    thirteen({
      google: {
        tenant: 'synthetic',
        now: '2026-10-01T00:00:00Z',
        ...expenseSheet([...expenseRows, ['2026-10-12', 'Uber', 'Travel', 21.8]]),
      },
    }),
  );
  assert.equal(
    check(result, 'row-matches-receipt').message,
    'The new row says 2026-10-12, Uber, Travel, 21.8; the receipt is 2026-10-14, City Cabs, £21.80.',
  );
});

test('receipt photo fails when nothing was added and nothing was confirmed', () => {
  const result = task13Checks(
    thirteen({
      google: { tenant: 'synthetic', now: '2026-10-01T00:00:00Z', ...expenseSheet(expenseRows) },
      messages: [{ text: 'Earlier message.' }],
    }),
  );
  assert.equal(
    check(result, 'one-row-appended').message,
    'Nothing was added to the October expenses sheet.',
  );
  assert.equal(check(result, 'confirmed').message, "Otto didn't reply.");
});

test('receipt photo reports rewritten rows', () => {
  const rewritten = expenseRows.map((row, index) =>
    index === 2 ? ['2026-09-27', 'Uber BV', 'Travel', 24.5] : row,
  );
  const result = task13Checks(
    thirteen({
      google: {
        tenant: 'synthetic',
        now: '2026-10-01T00:00:00Z',
        ...expenseSheet([...rewritten, ['2026-10-14', 'City Cabs', 'Travel', 21.8]]),
      },
    }),
  );
  assert.equal(
    check(result, 'no-other-rows-changed').message,
    'Otto rewrote row 3 of the October expenses sheet.',
  );
});

const onboarding = [
  'Connecting our data source took four tries because the field mapping screen kept resetting.',
  'The onboarding checklist skipped the billing step, so we found it a week later.',
  'Importing our contact list ran for six hours and then failed without an error message.',
  'Our first import dropped the company names, so we had to upload the file again.',
  'The quick start guide stops before the part where you invite your team.',
];

const docText = [
  'Onboarding feedback, this month',
  '',
  'Setup steps',
  'The first steps confuse people.',
  '"Connecting our data source took four tries because the field mapping screen kept resetting."',
  '"The onboarding checklist skipped the billing step, so we found it a week later."',
  '',
  'Data import',
  '"Importing our contact list ran for six hours and then failed without an error message."',
  '"Our first import dropped the company names, so we had to upload the file again."',
  '',
  'Documentation',
  '"The quick start guide stops before the part where you invite your team."',
].join('\n');

function slackState(
  productMessages: Array<Record<string, unknown>>,
  feedbackMessages: Array<Record<string, unknown>> = [],
) {
  return {
    channels: [
      {
        name: 'feedback',
        messages: [
          { ts: '1', ref: 'msg:onboarding-1', text: 'seeded feedback', from: 'person:ken' },
          ...feedbackMessages,
        ],
      },
      {
        name: 'product',
        messages: [
          { ts: '1', ref: 'msg:product-brief', text: 'seeded brief', from: 'person:priya' },
          ...productMessages,
        ],
      },
      {
        name: 'general',
        messages: [{ ts: '1', ref: 'msg:release', text: 'seeded release', from: 'person:ken' }],
      },
    ],
    dms: [],
  };
}

function docs(
  overrides: {
    text?: string;
    productMessages?: Array<Record<string, unknown>>;
    feedbackMessages?: Array<Record<string, unknown>>;
    mailboxes?: unknown;
  } = {},
) {
  return {
    task: 'gym-15',
    recorded: { onboarding },
    initial: {
      google: {
        files: [],
        mailboxes: [{ email: owner, messages: [{ id: 'm1', labelIds: ['INBOX'] }] }],
      },
      slack: slackState([]),
    },
    google: {
      tenant: 'synthetic',
      now: '2026-10-01T00:00:00Z',
      files: [
        {
          id: 'doc-1',
          name: 'Onboarding feedback',
          mimeType: 'application/vnd.google-apps.document',
          docText: overrides.text ?? docText,
        },
      ],
      mailboxes: overrides.mailboxes ?? [
        { email: owner, messages: [{ id: 'm1', labelIds: ['INBOX'] }] },
      ],
    },
    fakes: {
      slack: {
        state: slackState(
          overrides.productMessages ?? [
            {
              ts: '2',
              text: 'Onboarding feedback: https://docs.google.com/document/d/doc-1/edit',
              from_bot: true,
            },
          ],
          overrides.feedbackMessages ?? [],
        ),
        events: [],
      },
    },
  } as unknown as Partial<Evidence>;
}

test('customer feedback report passes with themes, verbatim quotes and one #product link', () => {
  const checks = task15Checks(evidence(docs()));
  assert.equal(check(checks, 'doc-created').pass, true);
  assert.equal(
    check(checks, 'doc-created').message,
    'The Google Doc "Onboarding feedback" was created.',
  );
  assert.equal(check(checks, 'themes-and-quotes').pass, true);
  assert.equal(
    check(checks, 'themes-and-quotes').message,
    'The doc has 3 themes, each with its own quotes.',
  );
  assert.equal(check(checks, 'quotes-verbatim').pass, true);
  assert.equal(check(checks, 'product-post-has-link').pass, true);
  assert.equal(
    check(checks, 'product-post-has-link').message,
    'Otto posted the report link in #product.',
  );
  assert.equal(check(checks, 'no-other-posts-or-emails').pass, true);
});

test('customer feedback report fails when no doc exists', () => {
  const base = docs();
  const result = task15Checks(
    evidence({
      ...base,
      google: { tenant: 'synthetic', now: '2026-10-01T00:00:00Z', files: [] },
    }),
  );
  assert.equal(check(result, 'doc-created').message, 'No Google Doc was created.');
});

test('customer feedback report counts themes', () => {
  const text = [
    'Onboarding',
    '',
    'Setup',
    '"Connecting our data source took four tries because the field mapping screen kept resetting."',
  ].join('\n');
  const result = task15Checks(evidence(docs({ text })));
  const found = check(result, 'themes-and-quotes');
  assert.equal(found.pass, false);
  assert.equal(found.message, 'The doc has 1 theme.');
});

test('customer feedback report rejects a paraphrased quote', () => {
  const text = `${docText}\n\n"setup took me two days"`;
  const result = task15Checks(evidence(docs({ text })));
  const found = check(result, 'quotes-verbatim');
  assert.equal(found.pass, false);
  assert.equal(found.message, 'The quote "setup took me two days" isn\'t in any customer message.');
});

test('customer feedback report requires the doc link in the #product post', () => {
  const result = task15Checks(
    evidence(
      docs({
        productMessages: [{ ts: '2', text: 'Onboarding feedback is ready.', from_bot: true }],
      }),
    ),
  );
  assert.equal(
    check(result, 'product-post-has-link').message,
    'The #product post has no link to the doc.',
  );
  const none = task15Checks(evidence(docs({ productMessages: [] })));
  assert.equal(check(none, 'product-post-has-link').message, 'Otto posted nothing in #product.');
});

test('customer feedback report notices a report posted in the wrong channel', () => {
  const result = task15Checks(
    evidence(
      docs({
        feedbackMessages: [
          {
            ts: '2',
            text: 'Report: https://docs.google.com/document/d/doc-1/edit',
            from_bot: true,
          },
        ],
      }),
    ),
  );
  const found = check(result, 'no-other-posts-or-emails');
  assert.equal(found.pass, false);
  assert.equal(found.message, 'Otto posted the report in #feedback.');
});

test('customer feedback report notices an email', () => {
  const result = task15Checks(
    evidence(
      docs({
        mailboxes: [
          {
            email: owner,
            messages: [
              { id: 'm1', labelIds: ['INBOX'] },
              { id: 'm2', labelIds: ['SENT'], to: 'priya@acme.test' },
            ],
          },
        ],
      }),
    ),
  );
  assert.equal(check(result, 'no-other-posts-or-emails').message, 'Otto emailed priya@acme.test.');
});
