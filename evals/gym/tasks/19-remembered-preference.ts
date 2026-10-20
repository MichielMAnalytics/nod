import type { Check, Evidence } from '../evidence.ts';
import type { TaskContext } from '../context.ts';
import type { Task } from '../task.ts';
import type { World } from '../world.ts';

const timeZone = 'Europe/London';

const firstPrompt = 'Remember I never take meetings before 10am.';
const secondPrompt = 'Book a 30 minute call with Jo tomorrow.';

interface CalendarEvent {
  id?: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string }>;
}

function events(evidence: Evidence) {
  const initial = new Set(
    ((evidence.initial?.google?.events ?? []) as CalendarEvent[])
      .map((event) => event.id)
      .filter((id): id is string => Boolean(id)),
  );
  const seen = new Set<string>();
  const created: CalendarEvent[] = [];
  for (const event of (evidence.google.events ?? []) as CalendarEvent[]) {
    if (!event.id || initial.has(event.id) || seen.has(event.id)) continue;
    if (event.status === 'cancelled') continue;
    seen.add(event.id);
    created.push(event);
  }
  return created;
}

function startOf(event: CalendarEvent | undefined) {
  const value = event?.start?.dateTime ?? event?.start?.date;
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function durationMinutes(event: CalendarEvent | undefined) {
  const start = startOf(event);
  const endValue = event?.end?.dateTime ?? event?.end?.date;
  const end = endValue ? new Date(endValue) : undefined;
  if (!start || !end || !Number.isFinite(end.getTime())) return undefined;
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

function wallTime(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return { hour, minute, minutes: hour * 60 + minute };
}

function hhmm(date: Date) {
  const wall = wallTime(date);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
}

function hasJo(event: CalendarEvent | undefined) {
  return (event?.attendees ?? []).some(
    (attendee) => String(attendee.email ?? '').toLowerCase() === 'jo@acme.test',
  );
}

export function task19Checks(evidence: Evidence): Check[] {
  const memory = evidence.memory;
  const notes = memory?.notes ?? [];
  const saved = notes.find((note) => /never take meetings before 10am/i.test(note.text));
  const created = events(evidence);
  const call = created.find((event) => hasJo(event)) ?? created[0];
  const start = startOf(call);
  const wall = start ? wallTime(start) : undefined;
  const duration = durationMinutes(call);
  const withinPreference = Boolean(wall && wall.minutes >= 10 * 60);

  return [
    {
      layer: 'Outcome',
      id: 'memory-saved',
      pass: Boolean(saved),
      message: saved
        ? `Memory saved the owner's words: "${saved.text}".`
        : 'Nothing was saved to memory.',
    },
    {
      layer: 'Outcome',
      id: 'call-after-ten',
      pass: withinPreference,
      message: !start
        ? 'No call with Jo was booked for tomorrow.'
        : withinPreference
          ? `The call starts at ${hhmm(start)}, after the saved 10am limit.`
          : `Otto booked ${hhmm(start)}, ignoring the saved preference "never before 10am".`,
    },
    {
      layer: 'Outcome',
      id: 'call-with-jo-thirty-minutes',
      pass: Boolean(call && hasJo(call) && duration === 30),
      message:
        !call || !hasJo(call)
          ? "The call doesn't include Jo."
          : duration === 30
            ? 'The call is 30 minutes with Jo.'
            : `The call is ${duration ?? 'an unknown number of'} minutes, not 30.`,
    },
  ];
}

const task: Task = {
  id: '19-remembered-preference',
  title: 'Remembered preference',
  channel: 'telegram',
  apps: ['calendar'],
  world(): World {
    return {
      world_version: 1,
      timezone: timeZone,
      persona: {
        ref: 'person:owner',
        name: 'Mia Chen',
        email: 'mia@acme.test',
        role: 'owner',
      },
      people: [{ ref: 'person:jo', name: 'Jo Kramer', email: 'jo@acme.test', org: 'org:acme' }],
      orgs: [{ ref: 'org:acme', name: 'Acme Ltd', domain: 'acme.test' }],
      entities: [
        {
          ref: 'event:owner-customer',
          kind: 'calendar_event',
          summary: 'Customer sync',
          at: '+1d 10:00',
          duration: '1h',
          attendees: ['person:owner'],
        },
        {
          ref: 'event:owner-focus',
          kind: 'calendar_event',
          summary: 'Focus block',
          at: '+1d 12:00',
          duration: '6h',
          attendees: ['person:owner'],
        },
        {
          ref: 'event:jo-hiring',
          kind: 'calendar_event',
          summary: 'Hiring panel',
          at: '+1d 10:00',
          duration: '1h',
          attendees: ['person:jo'],
        },
        {
          ref: 'event:jo-workshop',
          kind: 'calendar_event',
          summary: 'Workshop',
          at: '+1d 12:00',
          duration: '6h',
          attendees: ['person:jo'],
        },
      ],
      placement: {
        'event:owner-customer': ['google_calendar'],
        'event:owner-focus': ['google_calendar'],
        'event:jo-hiring': ['google_calendar'],
        'event:jo-workshop': ['google_calendar'],
      },
    };
  },
  async play(ctx: TaskContext) {
    await ctx.say(firstPrompt);
    await ctx.drive();
    await ctx.say(secondPrompt);
    await ctx.drive();
  },
  checks(evidence: Evidence) {
    return task19Checks(evidence);
  },
};

export default task;
