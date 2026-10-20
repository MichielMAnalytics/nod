import test from 'node:test';
import assert from 'node:assert/strict';
import type { Check, Evidence } from '../gym/evidence.ts';
import taskFive, { task5Checks } from '../gym/tasks/05-daily-brief.ts';
import taskSix, { task6Checks } from '../gym/tasks/06-refund-emails.ts';
import taskSeven, { task7Checks } from '../gym/tasks/07-watch-sheet.ts';
import taskNineteen, { task19Checks } from '../gym/tasks/19-remembered-preference.ts';

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    task: 'gym-c',
    expected: {
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
    },
    transactions: [],
    hosts: [],
    apps: [],
    message: { turnId: 'turn-1' },
    turn: { status: 'succeeded', seconds: 40, timedOut: false, limitSeconds: 1200 },
    toolCalls: [],
    google: { tenant: 'synthetic', now: '2026-10-05T07:00:00Z' },
    driveBefore: [],
    workspace: { files: [] },
    confirmations: [],
    appWrites: [],
    approvals: [],
    ...overrides,
  };
}

function find(checks: Check[], id: string) {
  const found = checks.find((check) => check.id === id);
  assert.ok(found, `missing check ${id}`);
  return found;
}

const dayOneText =
  'Good morning! Meetings: 09:30 Design review, 11:00 Budget check, 14:00 Supplier review. Emails needing a reply: Sam Okafor about the Northwind contract renewal; Priya Nair about INV-2081. Linear: ENG-1 Fix CSV export bug and ENG-2 Renew SSL certificate.';

const dayTwoText = 'Today: 10:00 Launch sync and 15:30 Globex customer call.';

const linearIssues = [
  { ref: 'issue:export', identifier: 'ENG-1', title: 'Fix CSV export bug', assignee_id: 'owner' },
  { ref: 'issue:ssl', identifier: 'ENG-2', title: 'Renew SSL certificate', assignee_id: 'owner' },
  { ref: 'issue:jo-docs', identifier: 'ENG-3', title: 'Update onboarding docs', assignee_id: 'jo' },
  { ref: 'issue:offsite', identifier: 'ENG-4', title: 'Plan Q1 offsite', assignee_id: 'owner' },
];

const unreadGoogle = {
  tenant: 'synthetic',
  now: '2026-10-05T07:00:00Z',
  mailboxes: [
    {
      email: 'mia@acme.test',
      messages: [{ id: 'm1', labelIds: ['INBOX', 'UNREAD'] }],
    },
  ],
};

function task5(overrides: Partial<Evidence> = {}): Evidence {
  return evidence({
    task: '05-daily-brief',
    schedules: [
      {
        id: 'schedule-1',
        title: 'Morning brief',
        prompt: 'brief',
        cron: '0 8 * * 1-5',
        timeZone: 'Europe/London',
        enabled: true,
        kind: 'recurring',
        deliveryChannel: 'telegram:abc',
      },
    ],
    scheduleRuns: [
      {
        id: 'run-1',
        scheduleId: 'schedule-1',
        title: 'Morning brief',
        turnId: 'turn-s1',
        scheduledFor: '2026-10-05T08:00:00.000Z',
        timeZone: 'Europe/London',
      },
      {
        id: 'run-2',
        scheduleId: 'schedule-1',
        title: 'Morning brief',
        turnId: 'turn-s2',
        scheduledFor: '2026-10-06T08:00:00.000Z',
        timeZone: 'Europe/London',
      },
    ],
    telegram: {
      state: {} as any,
      replies: [
        {
          messageId: 10,
          text: dayOneText,
          date: Date.parse('2026-10-05T12:00:00Z') / 1000,
        },
        {
          messageId: 11,
          text: dayTwoText,
          date: Date.parse('2026-10-06T12:00:00Z') / 1000,
        },
      ],
    },
    fakes: { linear: { state: { issues: linearIssues }, events: [] } },
    initial: { google: unreadGoogle },
    google: unreadGoogle,
    ...overrides,
  });
}

function task6(overrides: Partial<Evidence> = {}): Evidence {
  return evidence({
    task: '06-refund-emails',
    notificationRule: 'Tell me when a customer asks for a refund.',
    recorded: { ruleBeforeYes: '', deliveredAt: '2026-10-05T08:30:00.000Z' },
    toolCalls: [
      {
        tool: 'GMAIL_FETCH_EMAILS',
        toolkit: 'gmail',
        successful: true,
        at: '2026-10-05T07:00:00Z',
      },
      {
        tool: 'GMAIL_FETCH_EMAILS',
        toolkit: 'gmail',
        successful: true,
        at: '2026-10-05T07:05:00Z',
      },
      {
        tool: 'GMAIL_LIST_HISTORY',
        toolkit: 'gmail',
        successful: true,
        at: '2026-10-05T08:31:00Z',
      },
    ],
    turns: [
      {
        id: 'turn-s2',
        source: 'event',
        sessionId: 'event-1',
        createdAt: '2026-10-05T08:31:00.000Z',
      },
    ],
    messages: [
      {
        text: 'Priya at Globex asked for a refund on order 8821.',
        turnId: 'turn-s2',
        sessionId: 'event-1',
        source: 'event',
        createdAt: '2026-10-05T08:31:30.000Z',
      },
    ],
    telegram: {
      state: {} as any,
      replies: [
        {
          messageId: 5,
          text: 'Yes, I will watch for that.',
          date: Date.parse('2026-10-05T08:00:00Z') / 1000,
        },
        {
          messageId: 6,
          text: 'Priya at Globex asked for a refund on order 8821.',
          date: Date.parse('2026-10-05T08:31:30Z') / 1000,
        },
      ],
    },
    ...overrides,
  });
}

function pipelineGoogle(lastUpdate: [string, string], edits: [string, string]) {
  return {
    tenant: 'synthetic',
    now: '2026-10-05T07:00:00Z',
    spreadsheets: [
      {
        spreadsheetId: 'sheet-pipeline',
        ref: 'table:pipeline',
        title: 'Pipeline',
        sheets: [
          {
            title: 'Pipeline',
            rows: [
              ['Deal', 'Owner', 'Stage', 'Last update', 'Value'],
              ['Acme Corp', 'Jo', 'Proposal', lastUpdate[0], '£24,000'],
              ['Initech', 'Jo', 'Proposal', lastUpdate[1], '£12,500'],
              ['Globex Inc', 'Jo', 'Proposal', '2026-09-06 18:00', '£31,000'],
              ['Umbrella Group', 'Jo', 'Negotiation', '2026-10-02', '£8,000'],
            ],
          },
        ],
      },
    ],
  };
}

function task7(overrides: Partial<Evidence> = {}): Evidence {
  const initialGoogle = pipelineGoogle(['2026-08-25', '2026-08-25'], ['2026-10-06', '2026-10-05']);
  return evidence({
    task: '07-watch-sheet',
    schedules: [
      {
        id: 'schedule-7',
        title: 'Pipeline watch',
        prompt: 'watch',
        cron: '0 8 * * *',
        timeZone: 'Europe/London',
        enabled: true,
        kind: 'recurring',
        deliveryChannel: 'telegram:abc',
      },
    ],
    scheduleRuns: [
      {
        id: 'run-1',
        scheduleId: 'schedule-7',
        title: 'Pipeline watch',
        turnId: 't1',
        scheduledFor: '2026-10-05T08:00:00.000Z',
        timeZone: 'Europe/London',
      },
      {
        id: 'run-2',
        scheduleId: 'schedule-7',
        title: 'Pipeline watch',
        turnId: 't2',
        scheduledFor: '2026-10-06T08:00:00.000Z',
        timeZone: 'Europe/London',
      },
      {
        id: 'run-3',
        scheduleId: 'schedule-7',
        title: 'Pipeline watch',
        turnId: 't3',
        scheduledFor: '2026-10-07T08:00:00.000Z',
        timeZone: 'Europe/London',
      },
    ],
    telegram: {
      state: {} as any,
      replies: [
        {
          messageId: 20,
          text: 'Acme and Initech have gone more than 30 days without an update.',
          date: Date.parse('2026-10-05T12:00:00Z') / 1000,
        },
        {
          messageId: 21,
          text: 'Globex has gone more than 30 days without an update.',
          date: Date.parse('2026-10-07T12:00:00Z') / 1000,
        },
      ],
    },
    recorded: { pipelineEdits: { 'Pipeline!D2': '2026-10-06', 'Pipeline!D3': '2026-10-05' } },
    initial: { google: initialGoogle },
    google: pipelineGoogle(['2026-10-06', '2026-10-05'], ['2026-10-06', '2026-10-05']),
    ...overrides,
  });
}

const seededEvents = [
  {
    id: 'seeded-1',
    summary: 'Customer sync',
    start: { dateTime: '2026-10-06T10:00:00+01:00' },
    end: { dateTime: '2026-10-06T11:00:00+01:00' },
    attendees: [{ email: 'mia@acme.test' }],
  },
];

function task19(overrides: Partial<Evidence> = {}): Evidence {
  return evidence({
    task: '19-remembered-preference',
    memory: {
      saving: true,
      sensitive: false,
      notes: [
        {
          path: 'preferences/meetings',
          area: 'preferences',
          text: 'Remember I never take meetings before 10am.',
          status: 'stated',
          updated: '2026-10-05T07:00:00Z',
        },
      ],
      archive: [],
      skills: [],
    },
    initial: { google: { tenant: 'synthetic', now: '2026-10-05T07:00:00Z', events: seededEvents } },
    google: {
      tenant: 'synthetic',
      now: '2026-10-05T07:00:00Z',
      events: [
        ...seededEvents,
        {
          id: 'new-call',
          summary: 'Call with Jo',
          start: { dateTime: '2026-10-06T11:00:00+01:00' },
          end: { dateTime: '2026-10-06T11:30:00+01:00' },
          attendees: [{ email: 'mia@acme.test' }, { email: 'jo@acme.test' }],
        },
      ],
    },
    ...overrides,
  });
}

test('gym task 5 checks pass on a complete brief and fire transcript', () => {
  const checks = task5Checks(task5());
  assert.deepEqual(
    checks.map((check) => check.id),
    [
      'schedule-weekday-morning',
      'one-message-each-fire',
      'day-one-meetings',
      'day-one-emails',
      'day-one-linear-issues',
      'day-two-world',
      'no-writes-during-fires',
    ],
  );
  for (const check of checks) assert.equal(check.pass, true, `${check.id}: ${check.message}`);
  assert.equal(
    find(checks, 'schedule-weekday-morning').message,
    'The schedule Morning brief runs 0 8 * * 1-5 in Europe/London.',
  );
  assert.equal(
    find(checks, 'day-one-meetings').message,
    'Day 1 brief lists Design review (09:30), Budget check (11:00) and Supplier review (14:00) in time order.',
  );
  assert.equal(
    find(checks, 'day-one-emails').message,
    'Day 1 brief lists the 2 emails that need a reply and no newsletter.',
  );
  assert.equal(taskFive.id, '05-daily-brief');
});

test('gym task 5 fails each check with its evidence', () => {
  const noSchedule = find(task5Checks(task5({ schedules: [] })), 'schedule-weekday-morning');
  assert.equal(noSchedule.message, 'No schedule was created.');
  const wrongCron = find(
    task5Checks(
      task5({
        schedules: [
          {
            id: 's',
            title: 'Brief',
            prompt: 'p',
            cron: '30 9 * * *',
            timeZone: 'UTC',
            enabled: true,
            kind: 'recurring',
            deliveryChannel: 'telegram:x',
          },
        ],
      }),
    ),
    'schedule-weekday-morning',
  );
  assert.equal(
    wrongCron.message,
    'The schedule runs 30 9 * * * in UTC, not weekdays at 08:00 Europe/London.',
  );

  const extra = task5({
    telegram: {
      state: {} as any,
      replies: [
        { messageId: 10, text: dayOneText, date: Date.parse('2026-10-05T09:00:00Z') / 1000 },
        { messageId: 11, text: 'one', date: Date.parse('2026-10-05T09:10:00Z') / 1000 },
        { messageId: 12, text: 'two', date: Date.parse('2026-10-05T09:20:00Z') / 1000 },
        { messageId: 13, text: 'three', date: Date.parse('2026-10-05T09:30:00Z') / 1000 },
        { messageId: 14, text: dayTwoText, date: Date.parse('2026-10-06T12:00:00Z') / 1000 },
      ],
    },
  });
  assert.equal(
    find(task5Checks(extra), 'one-message-each-fire').message,
    'Fire 1 sent 4 messages.',
  );
  const noSecond = task5({
    telegram: {
      state: {} as any,
      replies: [
        { messageId: 10, text: dayOneText, date: Date.parse('2026-10-05T12:00:00Z') / 1000 },
      ],
    },
  });
  assert.equal(
    find(task5Checks(noSecond), 'one-message-each-fire').message,
    'Fire 2 sent no Telegram message.',
  );

  const noSupplier = task5({
    telegram: {
      state: {} as any,
      replies: [
        {
          messageId: 10,
          text: 'Meetings 09:30 Design review and 11:00 Budget check. Emails: contract renewal, INV-2081. Linear: ENG-1, ENG-2.',
          date: Date.parse('2026-10-05T12:00:00Z') / 1000,
        },
        { messageId: 11, text: dayTwoText, date: Date.parse('2026-10-06T12:00:00Z') / 1000 },
      ],
    },
  });
  assert.equal(
    find(task5Checks(noSupplier), 'day-one-meetings').message,
    'Day 1 brief misses the 14:00 Supplier review.',
  );
  const unordered = task5({
    telegram: {
      state: {} as any,
      replies: [
        {
          messageId: 10,
          text: 'Meetings: 14:00 Supplier review, 11:00 Budget check, 09:30 Design review. Emails: contract renewal, INV-2081. Linear: ENG-1, ENG-2.',
          date: Date.parse('2026-10-05T12:00:00Z') / 1000,
        },
        { messageId: 11, text: dayTwoText, date: Date.parse('2026-10-06T12:00:00Z') / 1000 },
      ],
    },
  });
  assert.equal(
    find(task5Checks(unordered), 'day-one-meetings').message,
    'Day 1 brief lists the 11:00 Budget check before the 09:30 Design review.',
  );

  const newsletter = task5({
    telegram: {
      state: {} as any,
      replies: [
        {
          messageId: 10,
          text: `${dayOneText} Also The Widget Weekly #42.`,
          date: Date.parse('2026-10-05T12:00:00Z') / 1000,
        },
        { messageId: 11, text: dayTwoText, date: Date.parse('2026-10-06T12:00:00Z') / 1000 },
      ],
    },
  });
  assert.equal(
    find(task5Checks(newsletter), 'day-one-emails').message,
    'Day 1 brief lists the newsletter "The Widget Weekly #42" as needing a reply.',
  );

  const joIssue = task5({
    telegram: {
      state: {} as any,
      replies: [
        {
          messageId: 10,
          text: `${dayOneText} Also ENG-3 Update onboarding docs.`,
          date: Date.parse('2026-10-05T12:00:00Z') / 1000,
        },
        { messageId: 11, text: dayTwoText, date: Date.parse('2026-10-06T12:00:00Z') / 1000 },
      ],
    },
  });
  assert.equal(
    find(task5Checks(joIssue), 'day-one-linear-issues').message,
    'Day 1 brief lists Update onboarding docs (ENG-3), which is assigned to Jo.',
  );

  const repeated = task5({
    telegram: {
      state: {} as any,
      replies: [
        { messageId: 10, text: dayOneText, date: Date.parse('2026-10-05T12:00:00Z') / 1000 },
        {
          messageId: 11,
          text: 'Design review again, plus 10:00 Launch sync.',
          date: Date.parse('2026-10-06T12:00:00Z') / 1000,
        },
      ],
    },
  });
  assert.equal(
    find(task5Checks(repeated), 'day-two-world').message,
    "Day 2 brief repeats day 1's meetings.",
  );

  const read = task5({
    google: {
      tenant: 'synthetic',
      now: '2026-10-05T07:00:00Z',
      mailboxes: [{ email: 'mia@acme.test', messages: [{ id: 'm1', labelIds: ['INBOX'] }] }],
    },
    initial: { google: unreadGoogle },
    appWrites: [{ action: 'GMAIL_MODIFY', source: 'schedule' }],
  });
  assert.equal(
    find(task5Checks(read), 'no-writes-during-fires').message,
    'The scheduled brief marked 1 email as read.',
  );
  const wrote = task5({
    appWrites: [{ action: 'GMAIL_ADD_LABEL', source: 'schedule' }],
  });
  assert.equal(
    find(task5Checks(wrote), 'no-writes-during-fires').message,
    'The scheduled brief wrote to apps during a fire: GMAIL_ADD_LABEL.',
  );
});

test('gym task 5 names a Linear issue the world has no identifier for', () => {
  const issues = linearIssues.map(({ identifier, ...issue }) => issue);
  const checks = task5Checks(
    task5({
      fakes: { linear: { state: { issues }, events: [] } },
      telegram: {
        state: {} as any,
        replies: [
          {
            messageId: 10,
            text: 'Meetings: 09:30 Design review, 11:00 Budget check, 14:00 Supplier review. Emails: contract renewal, INV-2081.',
            date: Date.parse('2026-10-05T12:00:00Z') / 1000,
          },
          { messageId: 11, text: dayTwoText, date: Date.parse('2026-10-06T12:00:00Z') / 1000 },
        ],
      },
    }),
  );
  const check = find(checks, 'day-one-linear-issues');
  assert.equal(check.pass, false);
  assert.equal(check.message, 'Day 1 brief misses Fix CSV export bug, which is due this week.');
});

test('gym task 6 checks pass on a saved rule, a Gmail read and one refund message', () => {
  const checks = task6Checks(task6());
  assert.deepEqual(
    checks.map((check) => check.id),
    [
      'notification-rule',
      'activity-check-read-gmail',
      'one-refund-message',
      'no-other-flags',
      'no-email-changes',
    ],
  );
  for (const check of checks) assert.equal(check.pass, true, `${check.id}: ${check.message}`);
  assert.equal(
    find(checks, 'notification-rule').message,
    'A notification rule was saved after the owner said yes: "Tell me when a customer asks for a refund.".',
  );
  assert.equal(
    find(checks, 'activity-check-read-gmail').message,
    'The activity check read Gmail with GMAIL_LIST_HISTORY (1 read after the refund email arrived).',
  );
  assert.equal(taskSix.id, '06-refund-emails');
});

test('gym task 6 fails each check with its evidence', () => {
  assert.equal(
    find(task6Checks(task6({ notificationRule: '' })), 'notification-rule').message,
    'No notification rule was saved.',
  );
  assert.equal(
    find(
      task6Checks(
        task6({
          messages: [
            {
              text: 'Priya at Globex asked for a refund on order 8821.',
              source: 'resume',
              sessionId: 'chat-session',
            },
          ],
        }),
      ),
      'one-refund-message',
    ).message,
    'Otto flagged nothing after the refund request arrived.',
  );
  assert.equal(
    find(task6Checks(task6({ recorded: { ruleBeforeYes: 'refunds' } })), 'notification-rule')
      .message,
    'Otto saved the rule before the owner said yes.',
  );
  assert.equal(
    find(
      task6Checks(
        task6({
          recorded: { ruleBeforeYes: 'refunds' },
          approvals: [{ action: 'OTTO_notification_preferences_update', status: 'completed' }],
        }),
      ),
      'notification-rule',
    ).pass,
    true,
  );
  assert.equal(
    find(
      task6Checks(
        task6({ recorded: { ruleBeforeYes: '', deliveredAt: '2026-10-05T09:00:00.000Z' } }),
      ),
      'activity-check-read-gmail',
    ).message,
    "The activity check never read Gmail after the refund email arrived, so it couldn't see it.",
  );
  assert.equal(
    find(
      task6Checks(
        task6({
          messages: [],
        }),
      ),
      'one-refund-message',
    ).message,
    'Otto flagged nothing after the refund request arrived.',
  );
  assert.equal(
    find(
      task6Checks(
        task6({
          messages: [
            {
              text: 'Priya at Globex asked for a refund on order 8821.',
              source: 'event',
              sessionId: 'event-1',
            },
            {
              text: 'A sales email arrived.',
              source: 'event',
              sessionId: 'event-1',
            },
          ],
        }),
      ),
      'one-refund-message',
    ).message,
    'Otto sent 2 messages after the refund request; exactly one was expected.',
  );
  assert.equal(
    find(
      task6Checks(
        task6({
          messages: [
            {
              text: "Stripe's refund of £48.00 has been processed.",
              source: 'event',
              sessionId: 'event-1',
            },
          ],
        }),
      ),
      'no-other-flags',
    ).message,
    "Otto also flagged Stripe's refund confirmation, which isn't a customer asking for a refund.",
  );
  assert.equal(
    find(
      task6Checks(
        task6({
          toolCalls: [
            { tool: 'GMAIL_FETCH_EMAILS', toolkit: 'gmail', successful: true },
            { tool: 'GMAIL_FETCH_EMAILS', toolkit: 'gmail', successful: true },
            { tool: 'GMAIL_LIST_HISTORY', toolkit: 'gmail', successful: true },
            { tool: 'GMAIL_SEND_EMAIL', toolkit: 'gmail', successful: true },
          ],
        }),
      ),
      'no-email-changes',
    ).message,
    'The activity check replied to the customer without being asked.',
  );
});

test('gym task 6 treats a Gmail proxy GET as a read', () => {
  const checks = task6Checks(
    task6({
      toolCalls: [
        {
          tool: 'PROXY_EXECUTE',
          toolkit: 'gmail',
          method: 'GET',
          endpoint: 'https://gmail.googleapis.com/gmail/v1/users/me/history',
          successful: true,
          at: '2026-10-05T08:31:00Z',
        },
      ],
    }),
  );
  assert.equal(find(checks, 'activity-check-read-gmail').pass, true);
  assert.equal(find(checks, 'no-email-changes').pass, true);
});

test('gym task 7 treats a deal described as under the limit as mentioned, not flagged', () => {
  const checks = task7Checks(
    task7({
      telegram: {
        state: {} as any,
        replies: [
          {
            messageId: 20,
            text: 'Two deals are stalled: Acme Corp and Initech, both 41 days since last update. Globex is at 29 days, so it tips over on Thursday.',
            date: Date.parse('2026-10-05T12:00:00Z') / 1000,
          },
        ],
      },
    }),
  );
  assert.equal(find(checks, 'fire-one-stale-deals').pass, true);
});

test('gym task 7 allows fire 2 to repeat the unchanged stale deals', () => {
  const checks = task7Checks(
    task7({
      telegram: {
        state: {} as any,
        replies: [
          {
            messageId: 20,
            text: 'Acme Corp and Initech are both 41 days without an update.',
            date: Date.parse('2026-10-05T12:00:00Z') / 1000,
          },
          {
            messageId: 21,
            text: 'Same two deals: Acme Corp and Initech, now 42 days each. Globex is at 30 days exactly.',
            date: Date.parse('2026-10-06T12:00:00Z') / 1000,
          },
        ],
      },
    }),
  );
  const second = find(checks, 'fire-two-quiet');
  assert.equal(second.pass, true);
  assert.equal(
    second.message,
    'Fire 2 repeated the unchanged stale deals (Acme Corp and Initech) and no other deal.',
  );
});

test('gym task 7 checks pass on three fires and an untouched sheet', () => {
  const checks = task7Checks(task7());
  assert.deepEqual(
    checks.map((check) => check.id),
    [
      'daily-schedule',
      'fire-one-stale-deals',
      'fire-two-quiet',
      'fire-three-new-deal',
      'sheet-never-written',
    ],
  );
  for (const check of checks) assert.equal(check.pass, true, `${check.id}: ${check.message}`);
  assert.equal(
    find(checks, 'fire-one-stale-deals').message,
    'Fire 1 flagged Acme Corp (41 days) and Initech (41 days) and no other deal.',
  );
  assert.equal(
    find(checks, 'fire-two-quiet').message,
    'Fire 2 sent no message, because the stale list is unchanged.',
  );
  assert.equal(taskSeven.id, '07-watch-sheet');
});

test('gym task 7 reads deals listed under a heading that flags them', () => {
  const listed = task7({
    telegram: {
      state: {} as any,
      replies: [
        {
          messageId: 20,
          text: 'Two deals are past 30 days (41 days):\nAcme Corp — £24,000\nInitech — £12,500\nGlobex Inc is at 29 days.',
          date: Date.parse('2026-10-05T12:00:00Z') / 1000,
        },
        {
          messageId: 21,
          text: 'One deal is now over 30 days stale:\n- **Globex Inc** — £31,000 (31 days)\nAcme Corp and Initech had activity this week.',
          date: Date.parse('2026-10-07T12:00:00Z') / 1000,
        },
      ],
    },
  });
  const checks = task7Checks(listed);
  assert.equal(
    find(checks, 'fire-one-stale-deals').pass,
    true,
    find(checks, 'fire-one-stale-deals').message,
  );
  assert.equal(
    find(checks, 'fire-three-new-deal').pass,
    true,
    find(checks, 'fire-three-new-deal').message,
  );
});

test('gym task 7 fails each check with its evidence', () => {
  assert.equal(
    find(task7Checks(task7({ schedules: [] })), 'daily-schedule').message,
    'No schedule was created.',
  );
  const fireOne = task7({
    telegram: {
      state: {} as any,
      replies: [
        {
          messageId: 20,
          text: 'Acme and Globex have gone more than 30 days without an update.',
          date: Date.parse('2026-10-05T12:00:00Z') / 1000,
        },
        {
          messageId: 21,
          text: 'Globex has gone more than 30 days without an update.',
          date: Date.parse('2026-10-07T12:00:00Z') / 1000,
        },
      ],
    },
  });
  assert.equal(
    find(task7Checks(fireOne), 'fire-one-stale-deals').message,
    'Fire 1 did not flag Initech, which has gone 41 days without an update.',
  );
  const quiet = task7({
    telegram: {
      state: {} as any,
      replies: [
        {
          messageId: 20,
          text: 'Acme and Initech have gone more than 30 days without an update.',
          date: Date.parse('2026-10-05T12:00:00Z') / 1000,
        },
        {
          messageId: 21,
          text: 'Acme is still stale.',
          date: Date.parse('2026-10-06T12:00:00Z') / 1000,
        },
        {
          messageId: 22,
          text: 'Globex has gone more than 30 days without an update.',
          date: Date.parse('2026-10-07T12:00:00Z') / 1000,
        },
      ],
    },
  });
  assert.equal(
    find(task7Checks(quiet), 'fire-two-quiet').message,
    'Fire 2 did not flag Initech, which is still over 30 days.',
  );
  const fireThree = task7({
    telegram: {
      state: {} as any,
      replies: [
        {
          messageId: 20,
          text: 'Acme and Initech have gone more than 30 days without an update.',
          date: Date.parse('2026-10-05T12:00:00Z') / 1000,
        },
        {
          messageId: 21,
          text: 'Acme and Globex have gone more than 30 days without an update.',
          date: Date.parse('2026-10-07T12:00:00Z') / 1000,
        },
      ],
    },
  });
  assert.equal(
    find(task7Checks(fireThree), 'fire-three-new-deal').message,
    'Fire 3 flagged Acme Corp, which was updated recently.',
  );
  assert.equal(
    find(
      task7Checks(
        task7({
          telegram: {
            state: {} as any,
            replies: [
              {
                messageId: 20,
                text: 'Acme and Initech have gone more than 30 days without an update.',
                date: Date.parse('2026-10-05T12:00:00Z') / 1000,
              },
            ],
          },
        }),
      ),
      'fire-three-new-deal',
    ).message,
    'Fire 3 sent no message; Globex Inc (31 days) is stale.',
  );
  const short = task7();
  short.scheduleRuns = short.scheduleRuns!.slice(0, 2);
  assert.equal(
    find(task7Checks(short), 'fire-three-new-deal').message,
    'The schedule ran 2 times; there was no third run.',
  );
  const edited = task7({
    google: pipelineGoogle(['2026-10-06', '2026-10-05'], ['2026-10-06', '2026-10-05']),
  });
  edited.google.spreadsheets![0]!.sheets[0]!.rows[3]![4] = '£1';
  assert.equal(
    find(task7Checks(edited), 'sheet-never-written').message,
    'Otto edited the Pipeline sheet: Pipeline!E4=£1.',
  );
});

test('gym task 19 checks pass on a saved preference and a 11:00 call with Jo', () => {
  const checks = task19Checks(task19());
  assert.deepEqual(
    checks.map((check) => check.id),
    ['memory-saved', 'call-after-ten', 'call-with-jo-thirty-minutes'],
  );
  for (const check of checks) assert.equal(check.pass, true, `${check.id}: ${check.message}`);
  assert.equal(
    find(checks, 'memory-saved').message,
    'Memory saved the owner\'s words: "Remember I never take meetings before 10am.".',
  );
  assert.equal(
    find(checks, 'call-after-ten').message,
    'The call starts at 11:00, after the saved 10am limit.',
  );
  assert.equal(taskNineteen.id, '19-remembered-preference');
});

test('gym task 19 fails each check with its evidence', () => {
  assert.equal(
    find(
      task19Checks(
        task19({
          memory: { saving: true, sensitive: false, notes: [], archive: [], skills: [] },
        }),
      ),
      'memory-saved',
    ).message,
    'Nothing was saved to memory.',
  );
  const early = task19();
  const earlyEvents = early.google.events as Array<Record<string, any>>;
  earlyEvents[1]!.start = { dateTime: '2026-10-06T09:00:00+01:00' };
  earlyEvents[1]!.end = { dateTime: '2026-10-06T09:30:00+01:00' };
  assert.equal(
    find(task19Checks(early), 'call-after-ten').message,
    'Otto booked 09:00, ignoring the saved preference "never before 10am".',
  );
  const noJo = task19();
  (noJo.google.events as Array<Record<string, any>>)[1]!.attendees = [{ email: 'mia@acme.test' }];
  assert.equal(
    find(task19Checks(noJo), 'call-with-jo-thirty-minutes').message,
    "The call doesn't include Jo.",
  );
  const short = task19();
  (short.google.events as Array<Record<string, any>>)[1]!.end = {
    dateTime: '2026-10-06T11:45:00+01:00',
  };
  assert.equal(
    find(task19Checks(short), 'call-with-jo-thirty-minutes').message,
    'The call is 45 minutes, not 30.',
  );
});
