import assert from 'node:assert/strict';
import test from 'node:test';
import type { Check, Evidence, Expected } from '../gym/evidence.ts';
import type { MonitorEvent } from '../gym/fakes.ts';
import { task8Checks } from '../gym/tasks/08-inbox-bugs-linear.ts';
import taskNine, { task9Checks } from '../gym/tasks/09-weekly-status-notion.ts';
import { task14Checks } from '../gym/tasks/14-hiring-pipeline.ts';
import { task20Checks } from '../gym/tasks/20-linear-triage-rulebook.ts';

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
    task: 'synthetic',
    expected,
    transactions: [],
    hosts: [],
    apps: [],
    message: { turnId: 'turn-1' },
    turn: { status: 'succeeded', seconds: 30, timedOut: false, limitSeconds: 1200 },
    toolCalls: [],
    google: { tenant: 'synthetic', now: '2026-10-15T10:00:00Z' },
    driveBefore: [],
    workspace: { files: [] },
    confirmations: [],
    appWrites: [],
    approvals: [],
    turns: [{ id: 'turn-1', startedAt: '2026-10-15T10:00:00Z' }],
    ...overrides,
  };
}

function check(checks: Check[], id: string) {
  const found = checks.find((entry) => entry.id === id);
  assert.ok(found, `missing check ${id}`);
  return found;
}

function event(
  seq: number,
  kind: string,
  type: string,
  extra: Partial<MonitorEvent> = {},
): MonitorEvent {
  return {
    service: 'fake',
    seq,
    ts: '2026-10-15T10:01:00Z',
    kind,
    type,
    outcome: 'success',
    request: { method: 'POST', path: '/mcp' },
    ...extra,
  };
}

function linearFake(
  state: Record<string, any>,
  events: MonitorEvent[] = [],
): NonNullable<Evidence['fakes']> {
  return {
    linear: { state, events },
  };
}

function notionFake(
  state: Record<string, any>,
  events: MonitorEvent[] = [],
): NonNullable<Evidence['fakes']> {
  return {
    notion: { state, events },
  };
}

function gmailState(messages: Array<Record<string, any>> = []) {
  return {
    tenant: 'synthetic',
    now: '2026-10-15T10:00:00Z',
    mailboxes: [{ email: 'owner@acme.test', messages }],
  };
}

const baseLinearIssue = {
  archived_at: null,
  priority: 0,
  assignee_id: null,
  state_id: 'todo',
};

test('task 8 passes when the bug reports become two detailed Linear issues', () => {
  const before = {
    issues: [
      {
        id: 'c1',
        identifier: 'ENG-31',
        ref: 'issue:time-zone',
        title: 'Scheduled reports show the wrong time zone',
        description: 'Reports are late.',
        ...baseLinearIssue,
        priority: 3,
      },
    ],
  };
  const after = {
    issues: [
      ...before.issues,
      {
        id: 'n1',
        identifier: 'ENG-32',
        title: 'Fix the Safari login loop',
        description:
          'The customer gets stuck in a login loop on Safari after signing in. ravi@northwind.test',
        ...baseLinearIssue,
      },
      {
        id: 'n2',
        identifier: 'ENG-33',
        title: 'CSV export crashes for large accounts',
        description: 'When they export a CSV the browser tab freezes. marta@globex.test',
        ...baseLinearIssue,
      },
    ],
  };
  const checks = task8Checks(
    evidence({
      initial: { linear: before },
      fakes: linearFake(after, [
        event(1, 'request', ''),
        event(2, 'request', ''),
        event(3, 'state_change', 'issue.created'),
        event(4, 'state_change', 'issue.created'),
      ]),
      google: gmailState(),
    }),
  );
  for (const entry of checks) assert.equal(entry.pass, true, entry.message);
  assert.equal(
    check(checks, 'two-new-eng-issues').message,
    'Otto created Fix the Safari login loop (ENG-32) for the login loop and CSV export crashes for large accounts (ENG-33) for the CSV export crash.',
  );
  assert.equal(check(checks, 'no-duplicate-eng-31').message, 'Otto did not duplicate ENG-31.');
});

test('task 8 checks report Linear reads, duplicates, extras and email replies', () => {
  const before = {
    issues: [
      {
        id: 'c1',
        identifier: 'ENG-31',
        title: 'Scheduled reports show the wrong time zone',
        ...baseLinearIssue,
      },
    ],
  };
  const issue = (id: string, identifier: string, title: string, description = 'generic') => ({
    id,
    identifier,
    title,
    description,
    ...baseLinearIssue,
  });
  const listed = check(
    task8Checks(
      evidence({
        initial: { linear: before },
        fakes: linearFake(
          { issues: [...before.issues, issue('n1', 'ENG-32', 'Safari login loop')] },
          [event(1, 'state_change', 'issue.created')],
        ),
      }),
    ),
    'linear-listed-before-create',
  );
  assert.equal(listed.pass, false);
  assert.equal(listed.message, 'Otto created issues without checking existing Linear issues.');

  const missing = check(
    task8Checks(
      evidence({
        initial: { linear: before },
        fakes: linearFake({
          issues: [...before.issues, issue('n1', 'ENG-32', 'Safari login loop')],
        }),
      }),
    ),
    'two-new-eng-issues',
  );
  assert.equal(missing.pass, false);
  assert.equal(missing.message, 'No issue for the CSV export crash (bug B).');

  const detail = check(
    task8Checks(
      evidence({
        initial: { linear: before },
        fakes: linearFake({
          issues: [
            ...before.issues,
            issue('n1', 'ENG-32', 'Safari login loop', 'login loop on Safari'),
            issue('n2', 'ENG-33', 'CSV export crash'),
          ],
        }),
      }),
    ),
    'issues-quote-email',
  );
  assert.equal(detail.pass, false);
  assert.equal(
    detail.message,
    "CSV export crash (ENG-33) has no detail from the customer's email.",
  );

  const duplicate = check(
    task8Checks(
      evidence({
        initial: { linear: before },
        fakes: linearFake({
          issues: [
            ...before.issues,
            issue('n1', 'ENG-32', 'Scheduled reports show the wrong time zone'),
          ],
        }),
      }),
    ),
    'no-duplicate-eng-31',
  );
  assert.equal(duplicate.pass, false);
  assert.equal(
    duplicate.message,
    'Otto duplicated ENG-31 as Scheduled reports show the wrong time zone (ENG-32).',
  );

  const feature = check(
    task8Checks(
      evidence({
        initial: { linear: before },
        fakes: linearFake({
          issues: [...before.issues, issue('n1', 'ENG-32', 'Feature request: dark mode')],
        }),
      }),
    ),
    'no-feature-or-thanks-issue',
  );
  assert.equal(feature.pass, false);
  assert.equal(
    feature.message,
    'Otto filed the feature request as Feature request: dark mode (ENG-32).',
  );

  const replied = check(
    task8Checks(
      evidence({
        initial: { linear: before, google: gmailState() },
        fakes: linearFake({ issues: before.issues }),
        google: gmailState([
          {
            id: 'm1',
            labels: ['SENT'],
            to: 'ravi@northwind.test',
            subject: 'Re: Login loop',
          },
        ]),
      }),
    ),
    'no-email-replies',
  );
  assert.equal(replied.pass, false);
  assert.match(replied.message, /^Otto replied to the customers without being asked: /);
});

function linearIssue(
  id: string,
  identifier: string,
  ref: string,
  title: string,
  state: string,
  completed?: string,
) {
  return {
    id,
    identifier,
    ref,
    title,
    state,
    state_id: state,
    completed_at: completed ?? null,
    canceled_at: null,
    archived_at: null,
    assignee_id: 'u1',
    priority: 3,
  };
}

function statusPage(id: string, markdown: string, parentId?: string) {
  return {
    id,
    title: 'Engineering status',
    markdown,
    trashed: false,
    parent: parentId
      ? { type: 'page_id', page_id: parentId }
      : { type: 'workspace', workspace: true },
  };
}

test('task 9 seeds last week outside a seven-day reading of this week', () => {
  const world = taskNine.world();
  const completed = (world.entities ?? []).find(
    (entity) => entity.title === 'Retire the legacy billing cron',
  );
  const at = new Date(String(completed?.at)).getTime();
  assert.ok(Number.isFinite(at));
  assert.ok(
    Date.now() - at > 6.9 * 86_400_000,
    `last week's issue was completed ${(Date.now() - at) / 86_400_000} days ago`,
  );
});

test('task 9 passes when the status page mirrors the week exactly', () => {
  const issues = [
    linearIssue(
      'd1',
      'ENG-1',
      'issue:done-1',
      'Ship billing export',
      'Done',
      '2026-10-13T09:00:00Z',
    ),
    linearIssue(
      'd2',
      'ENG-2',
      'issue:done-2',
      'Migrate search index',
      'Done',
      '2026-10-01T09:00:00Z',
    ),
    linearIssue('p1', 'ENG-3', 'issue:progress-1', 'Rebuild checkout', 'In Progress'),
    linearIssue('b1', 'ENG-4', 'issue:blocked-1', 'Warehouse migration', 'Blocked'),
  ];
  const status = statusPage('status', 'Old reports.', undefined);
  const markdown = [
    '## Shipped',
    '- ENG-1 Ship billing export',
    '## In progress',
    '- ENG-3 Rebuild checkout',
    '## Blocked',
    '- ENG-4 Warehouse migration',
  ].join('\n');
  const checks = task9Checks(
    evidence({
      initial: {
        linear: { issues },
        notion: { pages: [{ ...status, ref: 'page:status' }] },
      },
      fakes: {
        ...linearFake({ issues }, [event(1, 'request', '')]),
        ...notionFake({ pages: [status, statusPage('new', markdown, 'status')] }),
      },
      recorded: {
        week: {
          start: '2026-10-12T00:00:00Z',
          end: '2026-10-19T00:00:00Z',
          now: '2026-10-15T10:00:00Z',
        },
      },
    }),
  );
  for (const entry of checks) assert.equal(entry.pass, true, entry.message);
  assert.equal(
    check(checks, 'shipped-exact').message,
    'Shipped lists exactly the issues done this week (Ship billing export (ENG-1)).',
  );
});

test('task 9 checks report missing writes, wrong parents, extra and missing sections and changes', () => {
  const issues = [
    linearIssue(
      'd1',
      'ENG-1',
      'issue:done-1',
      'Ship billing export',
      'Done',
      '2026-10-13T09:00:00Z',
    ),
    linearIssue(
      'd2',
      'ENG-2',
      'issue:done-2',
      'Migrate search index',
      'Done',
      '2026-10-01T09:00:00Z',
    ),
    linearIssue('p1', 'ENG-3', 'issue:progress-1', 'Rebuild checkout', 'In Progress'),
    linearIssue('b1', 'ENG-4', 'issue:blocked-1', 'Warehouse migration', 'Blocked'),
  ];
  const recorded = {
    week: {
      start: '2026-10-12T00:00:00Z',
      end: '2026-10-19T00:00:00Z',
      now: '2026-10-15T10:00:00Z',
    },
  };
  const status = { ...statusPage('status', 'Old reports.'), ref: 'page:status' };
  const page = (markdown: string, parentId?: string) => statusPage('new', markdown, parentId);
  const base = (markdown: string, parentId?: string, afterIssues = issues) =>
    evidence({
      initial: { linear: { issues }, notion: { pages: [status] } },
      fakes: {
        ...linearFake({ issues: afterIssues }, [event(1, 'request', '')]),
        ...notionFake({ pages: [status, page(markdown, parentId)] }),
      },
      recorded,
    });

  const nothing = check(
    task9Checks(
      evidence({
        initial: { linear: { issues }, notion: { pages: [status] } },
        fakes: { ...linearFake({ issues }), ...notionFake({ pages: [status] }) },
        recorded,
      }),
    ),
    'linear-listed-and-notion-written',
  );
  assert.equal(nothing.pass, false);
  assert.equal(nothing.message, 'Nothing was written to Notion.');

  const root = check(
    task9Checks(base('## Shipped\n- ENG-1\n## In progress\n- ENG-3\n## Blocked\n- ENG-4')),
    'status-page-under-reports',
  );
  assert.equal(root.pass, false);
  assert.equal(
    root.message,
    'The status page was created at the workspace root instead of under Status reports.',
  );

  const extra = check(
    task9Checks(
      base('## Shipped\n- ENG-1\n- ENG-2\n## In progress\n- ENG-3\n## Blocked\n- ENG-4', 'status'),
    ),
    'shipped-exact',
  );
  assert.equal(extra.pass, false);
  assert.equal(
    extra.message,
    'Shipped includes Migrate search index (ENG-2), completed two weeks ago.',
  );

  const blocked = check(
    task9Checks(base('## Shipped\n- ENG-1\n## In progress\n- ENG-3\n## Blocked\n', 'status')),
    'progress-and-blocked-exact',
  );
  assert.equal(blocked.pass, false);
  assert.equal(blocked.message, 'Blocked misses Warehouse migration (ENG-4) (state Blocked).');

  const linked = check(
    task9Checks(
      evidence({
        initial: { linear: { issues }, notion: { pages: [status] } },
        fakes: {
          ...linearFake({ issues }, [event(1, 'request', '')]),
          ...notionFake({
            pages: [
              {
                ...status,
                markdown:
                  'Old reports.\n\n<page url="https://www.notion.so/new">Engineering status</page>',
              },
              page('## Shipped\n- ENG-1\n## In progress\n- ENG-3\n## Blocked\n- ENG-4', 'status'),
            ],
          }),
        },
        recorded,
      }),
    ),
    'no-other-notion-or-linear-change',
  );
  assert.equal(linked.pass, true, linked.message);

  const edited = check(
    task9Checks(
      evidence({
        initial: { linear: { issues }, notion: { pages: [status] } },
        fakes: {
          ...linearFake({ issues }, [event(1, 'request', '')]),
          ...notionFake({
            pages: [
              { ...status, markdown: 'Changed.' },
              page('## Shipped\n- ENG-1\n## In progress\n- ENG-3\n## Blocked\n- ENG-4', 'status'),
            ],
          }),
        },
        recorded,
      }),
    ),
    'no-other-notion-or-linear-change',
  );
  assert.equal(edited.pass, false);
  assert.equal(edited.message, 'Otto edited the Status reports page itself.');

  const changed = check(
    task9Checks(
      base(
        '## Shipped\n- ENG-1\n## In progress\n- ENG-3\n## Blocked\n- ENG-4',
        'status',
        issues.map((issue) => (issue.id === 'p1' ? { ...issue, state_id: 'Todo' } : issue)),
      ),
    ),
    'no-other-notion-or-linear-change',
  );
  assert.equal(changed.pass, false);
  assert.equal(changed.message, "Otto changed Rebuild checkout (ENG-3)'s state.");
});

function candidatesState(statuses: Record<string, string>) {
  return {
    databases: [
      {
        id: 'db',
        title: 'Candidates',
        rows: Object.entries(statuses).map(([ref, status]) => ({
          id: ref,
          ref,
          properties: { Status: status },
        })),
      },
    ],
  };
}

function offer(start: string, label: string) {
  return {
    start,
    end: new Date(new Date(start).getTime() + 3_600_000).toISOString(),
    label,
  };
}

function calendarEvent(id: string, email: string, start: string) {
  return {
    id,
    status: 'confirmed',
    summary: 'Interview',
    start: { dateTime: start },
    end: { dateTime: new Date(new Date(start).getTime() + 3_600_000).toISOString() },
    attendees: [{ email }],
  };
}

function hiringEvidence(options: {
  statuses?: Record<string, string>;
  events?: Array<Record<string, any>>;
  assistant?: string[];
  sent?: Array<Record<string, any>>;
}) {
  const beforeStatuses = {
    'candidate:ana': 'Contacted',
    'candidate:ben': 'Contacted',
    'candidate:chen': 'Contacted',
    'candidate:dee': 'Contacted',
    'candidate:farah': 'Screening',
    'candidate:gita': 'Offer',
  };
  const afterStatuses = options.statuses ?? {
    ...beforeStatuses,
    'candidate:ana': 'Interview',
    'candidate:ben': 'Interview',
    'candidate:chen': 'Declined',
  };
  return evidence({
    initial: {
      notion: candidatesState(beforeStatuses),
      google: { mailboxes: [{ email: 'owner@acme.test', messages: [] }], events: [] },
    },
    fakes: {
      ...notionFake(candidatesState(afterStatuses)),
      google: {
        state: { mailboxes: [{ email: 'owner@acme.test', messages: options.sent ?? [] }] },
        events: [],
      },
    },
    google: {
      tenant: 'synthetic',
      now: '2026-10-15T10:00:00Z',
      mailboxes: [{ email: 'owner@acme.test', messages: options.sent ?? [] }],
      events: options.events ?? [],
    },
    recorded: {
      offers: {
        ana: [offer('2026-10-21T13:00:00Z', 'Wednesday 14:00')],
        ben: [
          offer('2026-10-21T09:00:00Z', 'Wednesday 10:00'),
          offer('2026-10-22T09:00:00Z', 'Thursday 10:00'),
        ],
        timeZone: 'Europe/London',
      },
      candidates: [
        { ref: 'candidate:ana', name: 'Ana Duarte', email: 'ana@candidate.test' },
        { ref: 'candidate:ben', name: 'Ben Osei', email: 'ben@candidate.test' },
        { ref: 'candidate:chen', name: 'Chen Wu', email: 'chen@candidate.test' },
        { ref: 'candidate:dee', name: 'Dee Patel', email: 'dee@candidate.test' },
      ],
      assistant: options.assistant ?? ['Dee asked about the salary range.'],
    },
  });
}

test('task 14 passes when the tracker, interviews and report are right', () => {
  const checks = task14Checks(
    hiringEvidence({
      events: [
        calendarEvent('e1', 'ana@candidate.test', '2026-10-21T13:00:00Z'),
        calendarEvent('e2', 'ben@candidate.test', '2026-10-22T09:00:00Z'),
      ],
    }),
  );
  for (const entry of checks) assert.equal(entry.pass, true, entry.message);
  assert.equal(
    check(checks, 'tracker-statuses').message,
    'Ana and Ben are Interview, Chen is Declined, and the others are unchanged.',
  );
});

test('task 14 checks report wrong statuses, wrong interview times, an unreported question and replies', () => {
  const status = check(
    task14Checks(
      hiringEvidence({
        statuses: {
          'candidate:ana': 'Interview',
          'candidate:ben': 'Interview',
          'candidate:chen': 'Contacted',
          'candidate:dee': 'Contacted',
          'candidate:farah': 'Screening',
          'candidate:gita': 'Offer',
        },
        events: [
          calendarEvent('e1', 'ana@candidate.test', '2026-10-21T13:00:00Z'),
          calendarEvent('e2', 'ben@candidate.test', '2026-10-22T09:00:00Z'),
        ],
      }),
    ),
    'tracker-statuses',
  );
  assert.equal(status.pass, false);
  assert.equal(status.message, 'Chen is still "Contacted" in the tracker after declining.');

  const interview = check(
    task14Checks(
      hiringEvidence({
        events: [
          calendarEvent('e1', 'ana@candidate.test', '2026-10-21T13:00:00Z'),
          calendarEvent('e2', 'ben@candidate.test', '2026-10-20T14:00:00Z'),
        ],
      }),
    ),
    'interviews-inside-offers',
  );
  assert.equal(interview.pass, false);
  assert.equal(
    interview.message,
    "Ben's interview is on Tuesday at 15:00; he offered Wednesday 10:00 or Thursday 10:00.",
  );

  const unreported = check(
    task14Checks(
      hiringEvidence({
        assistant: ['Updated the candidates tracker.'],
        events: [
          calendarEvent('e1', 'ana@candidate.test', '2026-10-21T13:00:00Z'),
          calendarEvent('e2', 'ben@candidate.test', '2026-10-22T09:00:00Z'),
        ],
      }),
    ),
    'dee-question-reported',
  );
  assert.equal(unreported.pass, false);
  assert.equal(unreported.message, "Otto didn't tell the owner Dee asked about salary.");

  const replied = check(
    task14Checks(
      hiringEvidence({
        sent: [
          {
            id: 's1',
            labels: ['SENT'],
            to: 'dee@candidate.test',
            subject: 'Re: salary',
          },
        ],
        events: [
          calendarEvent('e1', 'ana@candidate.test', '2026-10-21T13:00:00Z'),
          calendarEvent('e2', 'ben@candidate.test', '2026-10-22T09:00:00Z'),
        ],
      }),
    ),
    'no-reply-to-dee-or-chen',
  );
  assert.equal(replied.pass, false);
  assert.equal(replied.message, "Otto answered Dee's salary question itself.");
});

const opsRefs = [
  'issue:ops-billing',
  'issue:ops-auth',
  'issue:ops-exports',
  'issue:ops-integrations',
  'issue:ops-notifications',
  'issue:ops-mobile',
];

function triageState(options: {
  assignees?: Record<string, string>;
  priorities?: Record<string, number>;
  omitComments?: string[];
  engState?: string;
}) {
  const users = [
    { id: 'u-owner', ref: 'person:owner', name: 'Alex Morgan' },
    { id: 'u-priya', ref: 'person:priya', name: 'Priya Nair' },
    { id: 'u-sam', ref: 'person:sam', name: 'Sam Rivera' },
    { id: 'u-jo', ref: 'person:jo', name: 'Jo Kramer' },
    { id: 'u-ken', ref: 'person:ken', name: 'Ken Ito' },
    { id: 'u-ana', ref: 'person:ana', name: 'Ana Duarte' },
    { id: 'u-ben', ref: 'person:ben', name: 'Ben Osei' },
  ];
  const wanted = ['u-priya', 'u-sam', 'u-jo', 'u-ken', 'u-ana', 'u-ben'];
  const issues = opsRefs.map((ref, index) => ({
    id: `ops-${index + 1}`,
    identifier: `OPS-${index + 1}`,
    ref,
    title: `OPS issue ${index + 1}`,
    state_id: 'todo',
    archived_at: null,
    assignee_id: options.assignees?.[ref] ?? wanted[index],
    priority: options.priorities?.[ref] ?? [2, 1, 3, 1, 4, 2][index],
  }));
  issues.push(
    {
      id: 'ops-7',
      identifier: 'OPS-7',
      ref: 'issue:ops-laptop',
      title: 'Provision a laptop for the design hire',
      state_id: 'todo',
      archived_at: null,
      assignee_id: options.assignees?.['issue:ops-laptop'] ?? 'u-owner',
      priority: 0,
    },
    {
      id: 'ops-8',
      identifier: 'OPS-8',
      ref: 'issue:ops-parking',
      title: 'Book parking permits for the office move',
      state_id: 'todo',
      archived_at: null,
      assignee_id: options.assignees?.['issue:ops-parking'] ?? 'u-owner',
      priority: 0,
    },
    {
      id: 'eng-4',
      identifier: 'ENG-4',
      ref: 'issue:eng-4',
      title: 'Existing billing work',
      state_id: options.engState ?? 'started',
      archived_at: null,
      assignee_id: 'u-priya',
      priority: 2,
    },
  );
  const comments = opsRefs.flatMap((ref, index) => {
    if (options.omitComments?.includes(ref)) return [];
    return [
      {
        id: `comment-${index}`,
        issue_id: `ops-${index + 1}`,
        body: ['Billing', 'Authentication', 'Exports', 'Integrations', 'Notifications', 'Mobile'][
          index
        ],
        user_id: 'u-owner',
        parent_id: null,
      },
    ];
  });
  return { issues, users, comments };
}

test('task 20 passes when the rules are applied and the gaps are reported', () => {
  const before = triageState({
    assignees: Object.fromEntries(opsRefs.map((ref) => [ref, 'u-owner'])),
    priorities: Object.fromEntries(opsRefs.map((ref) => [ref, 0])),
    omitComments: opsRefs,
  });
  const after = triageState({});
  const checks = task20Checks(
    evidence({
      initial: { linear: before },
      fakes: {
        ...linearFake(after),
        ...notionFake({}, [event(1, 'request', '')]),
      },
      recorded: { assistant: ['OPS-7 and OPS-8 have no matching rule.'] },
    }),
  );
  for (const entry of checks) assert.equal(entry.pass, true, entry.message);
  assert.equal(
    check(checks, 'covered-issues-triaged').message,
    "All 6 covered OPS issues have the rule's assignee and priority.",
  );
});

test('task 20 checks report an unread rulebook, wrong triage, missing comments, guesses and outside changes', () => {
  const before = triageState({
    assignees: Object.fromEntries(opsRefs.map((ref) => [ref, 'u-owner'])),
    priorities: Object.fromEntries(opsRefs.map((ref) => [ref, 0])),
    omitComments: opsRefs,
  });
  const base = (
    after: ReturnType<typeof triageState>,
    assistant = 'OPS-7 and OPS-8 have no matching rule.',
  ) =>
    evidence({
      initial: { linear: before },
      fakes: { ...linearFake(after), ...notionFake({}, [event(1, 'request', '')]) },
      recorded: { assistant: [assistant] },
    });

  const unread = check(
    task20Checks(
      evidence({
        initial: { linear: before },
        fakes: { ...linearFake(triageState({ omitComments: [] })), ...notionFake({}) },
        recorded: { assistant: ['OPS-7 and OPS-8 have no matching rule.'] },
      }),
    ),
    'rules-page-read',
  );
  assert.equal(unread.pass, false);
  assert.equal(unread.message, 'Otto never read the Triage rules page.');

  const untriaged = check(
    task20Checks(
      base(
        triageState({
          assignees: Object.fromEntries(opsRefs.map((ref) => [ref, 'u-owner'])),
          priorities: Object.fromEntries(opsRefs.map((ref) => [ref, 0])),
          omitComments: opsRefs,
        }),
      ),
    ),
    'covered-issues-triaged',
  );
  assert.equal(untriaged.pass, false);
  assert.equal(
    untriaged.message,
    '6 covered OPS issues are still untriaged; OPS issue 1 (OPS-1) should go to Priya.',
  );

  const wrong = check(
    task20Checks(
      base(
        triageState({
          omitComments: opsRefs,
          assignees: { 'issue:ops-billing': 'u-ken' },
        }),
      ),
    ),
    'covered-issues-triaged',
  );
  assert.equal(wrong.pass, false);
  assert.equal(
    wrong.message,
    'OPS issue 1 (OPS-1) (billing) went to Ken; the rules give billing to Priya.',
  );

  const noComment = check(
    task20Checks(base(triageState({ omitComments: ['issue:ops-exports'] }))),
    'comment-per-triage',
  );
  assert.equal(noComment.pass, false);
  assert.equal(noComment.message, 'OPS issue 3 (OPS-3) was triaged without a comment.');

  const guessed = check(
    task20Checks(
      base(
        triageState({
          omitComments: opsRefs,
          assignees: { 'issue:ops-parking': 'u-ken' },
        }),
      ),
    ),
    'uncovered-untouched-and-listed',
  );
  assert.equal(guessed.pass, false);
  assert.equal(
    guessed.message,
    'Otto guessed an assignee for Book parking permits for the office move (OPS-8), which no rule covers.',
  );

  const changed = check(
    task20Checks(base(triageState({ omitComments: opsRefs, engState: 'completed' }))),
    'no-issues-outside-ops-changed',
  );
  assert.equal(changed.pass, false);
  assert.equal(changed.message, 'Otto changed Existing billing work (ENG-4).');
});
