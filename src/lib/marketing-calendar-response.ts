import { z } from 'zod';
import type { MarketingCalendarSource, MarketingCalendarsResponse } from '@/lib/marketing-calendars';

export const MAX_CALENDAR_ENTRIES = 1_000;
export const MAX_PRELAUNCH_ITEMS = 200;
export const MARKETING_CALENDAR_MAX_TEXT = 300;
export const MARKETING_CALENDAR_MAX_TIP_REFS = 20;
const text = z.string().max(MARKETING_CALENDAR_MAX_TEXT);
const identity = text.min(1).refine(value => value.trim() === value);
const entry = z.strictObject({
  id: identity, date: z.iso.date(), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
  platform: text, kind: text, title: text.min(1), status: text.min(1),
  tipRefs: z.array(text.min(1)).max(MARKETING_CALENDAR_MAX_TIP_REFS),
});
const prelaunch = z.strictObject({ id: identity, due: z.iso.date(), title: text.min(1), owner: text.nullable(), repo: text.regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/).nullable(), issue: text.regex(/^#\d+$/).nullable(), status: text.min(1) });
const unique = (items: Array<{ id: string }>) => new Set(items.map(item => item.id)).size === items.length;
const calendar = z.strictObject({
  name: text.min(1), launch: z.iso.date().nullable(), periodStart: z.iso.date().nullable(), periodEnd: z.iso.date().nullable(),
  entries: z.array(entry).max(MAX_CALENDAR_ENTRIES).refine(unique), prelaunch: z.array(prelaunch).max(MAX_PRELAUNCH_ITEMS).refine(unique), skipped: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const source = z.object({
  id: text.min(1), label: text.min(1), repo: text.min(1), path: text.min(1), calendarUrl: z.string().max(2000),
  status: z.enum(['ok', 'not-found', 'unreadable', 'disconnected', 'invalid-json', 'wrong-schema', 'wrong-project', 'too-large', 'error']), detail: text.nullable(), calendar: calendar.nullable(),
}).refine(value => (value.status === 'ok') === (value.calendar !== null));
const response = z.strictObject({ checkedAt: z.iso.datetime({ offset: true }), sources: z.array(source).max(20) });

/** Every configured source must have one explicit outcome and its canonical public destination. */
export function parseMarketingCalendarsResponse(value: unknown, registered: readonly MarketingCalendarSource[]): MarketingCalendarsResponse {
  const parsed = response.parse(value);
  if (parsed.sources.length !== registered.length || !unique(parsed.sources)) throw new Error('Calendar response unavailable');
  for (const item of parsed.sources) {
    const expected = registered.find(source => source.id === item.id);
    if (!expected || item.label !== expected.label || item.repo !== expected.repo || item.path !== expected.path || item.calendarUrl !== expected.calendarUrl) throw new Error('Calendar response unavailable');
  }
  return parsed;
}
