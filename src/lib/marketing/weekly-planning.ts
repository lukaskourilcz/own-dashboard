import { z } from 'zod';
import { BrandSchema, PlatformSchema, type MarketingBrand } from './contracts';
import { pragueScheduledAt } from './clock';

export const MARKETING_PLANNING_TIME_ZONE = 'Europe/Prague' as const;
/** DNESKAi plans from briefs (#115) first; an approved article remains a valid source while the article cycle is paused. */
export const MARKETING_PLANNING_SOURCE_KINDS = { devshark: ['question', 'coding-task'], dneskai: ['brief', 'article'] } as const;
export const MARKETING_DAILY_QUOTAS = { devshark: { carousel: 1, thread: 2, story: 3 }, dneskai: { carousel: 4, thread: 0, story: 0 } } as const;
export type MarketingWeekWindow = { timeZone: typeof MARKETING_PLANNING_TIME_ZONE; startDate: string; endDateInclusive: string; endDateExclusive: string; startAt: string; endAtExclusive: string; dates: string[] };
function calendarDay(date: string, offset: number): string {
  z.iso.date().parse(date);
  return new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
export function pragueMarketingDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('invalid-planning-time');
  return new Intl.DateTimeFormat('sv-SE', { timeZone: MARKETING_PLANNING_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
/** Seven calendar days, which may span 167/169 real hours across Prague DST. */
export function sevenDayMarketingWindow(startDate: string): MarketingWeekWindow {
  z.iso.date().parse(startDate);
  const dates = Array.from({ length: 7 }, (_, index) => calendarDay(startDate, index));
  const endDateExclusive = calendarDay(startDate, 7);
  return { timeZone: MARKETING_PLANNING_TIME_ZONE, startDate, endDateInclusive: dates[6], endDateExclusive,
    startAt: pragueScheduledAt(startDate, '00:00'), endAtExclusive: pragueScheduledAt(endDateExclusive, '00:00'), dates };
}
export function rollingMarketingWindow(now: Date): MarketingWeekWindow { return sevenDayMarketingWindow(pragueMarketingDate(now)); }
/** Cadence is planning advice, never a source eligibility, owner approval or publish decision. */
export function marketingPreparationPlan(brand: MarketingBrand, now: Date) {
  BrandSchema.parse(brand);
  const localDate = pragueMarketingDate(now), weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  if (brand === 'dneskai') return { brand, mode: 'daily-fresh' as const,
    due: now.getTime() >= Date.parse(pragueScheduledAt(localDate, '22:00')),
    preparationDate: localDate, targetDate: calendarDay(localDate, 1), dailyTarget: 4,
    sourceDates: [localDate], reviewRequired: true as const, timeZone: MARKETING_PLANNING_TIME_ZONE };
  const sunday = calendarDay(localDate, (7 - weekday) % 7);
  return { brand, mode: 'weekly-sunday' as const, due: weekday === 0, preparationDate: sunday,
    sourceDates: sevenDayMarketingWindow(sunday).dates, reviewRequired: true as const, timeZone: MARKETING_PLANNING_TIME_ZONE };
}
export type MarketingSlotCadence = { brand: MarketingBrand; platform: 'instagram' | 'threads'; format: 'carousel' | 'thread' | 'story'; localTime: string };
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const cadenceSchema = z.array(z.strictObject({ brand: BrandSchema, platform: PlatformSchema, format: z.enum(['carousel', 'thread', 'story']), localTime })
  .refine(item => item.format === 'thread' ? item.platform === 'threads' : item.platform === 'instagram', 'slot-format-platform-mismatch')).max(12);
type DevsharkDailyTimes = { carousel: string; threads: readonly [string, string]; stories: readonly [string, string, string] };
/** The single DNESKAi carousel overload retains historical plans; new plans supply four explicit times. */
export function marketingDailyCadence(brand: 'devshark', value: DevsharkDailyTimes): MarketingSlotCadence[];
export function marketingDailyCadence(brand: 'dneskai', value: { carousel: string }): MarketingSlotCadence[];
export function marketingDailyCadence(brand: 'dneskai', value: { carousels: readonly [string, string, string, string] }): MarketingSlotCadence[];
export function marketingDailyCadence(brand: MarketingBrand, value: DevsharkDailyTimes | { carousel: string } | { carousels: readonly [string, string, string, string] }): MarketingSlotCadence[] {
  BrandSchema.parse(brand);
  if (brand === 'dneskai') {
    if ('carousels' in value) {
      const times = z.strictObject({ carousels: z.tuple([localTime, localTime, localTime, localTime]) }).parse(value);
      if (new Set(times.carousels).size !== 4) throw new Error('duplicate-marketing-cadence');
      return times.carousels.map(localTime => ({ brand, platform: 'instagram', format: 'carousel', localTime }));
    }
    const times = z.strictObject({ carousel: localTime }).parse(value);
    return [{ brand, platform: 'instagram', format: 'carousel', localTime: times.carousel }];
  }
  const times = z.strictObject({ carousel: localTime, threads: z.tuple([localTime, localTime]), stories: z.tuple([localTime, localTime, localTime]) }).parse(value);
  return cadenceSchema.parse([{ brand, platform: 'instagram', format: 'carousel', localTime: times.carousel },
    ...times.threads.map(localTime => ({ brand, platform: 'threads', format: 'thread', localTime })),
    ...times.stories.map(localTime => ({ brand, platform: 'instagram', format: 'story', localTime }))]);
}
/** Empty cadence creates no slots. Times/frequency come from explicit configuration, never approval inference. */
export function planMarketingWeekSlots(startDate: string, value: readonly MarketingSlotCadence[]) {
  const window = sevenDayMarketingWindow(startDate), cadence = cadenceSchema.parse(value);
  const identities = cadence.map(item => `${item.brand}|${item.platform}|${item.format}|${item.localTime}`);
  if (new Set(identities).size !== identities.length) throw new Error('duplicate-marketing-cadence');
  return window.dates.flatMap(date => cadence.map(item => ({ ...item, date, scheduledAt: pragueScheduledAt(date, item.localTime), timeZone: MARKETING_PLANNING_TIME_ZONE,
    slotKey: `${item.brand}|${item.platform}|${item.format}|${date}|${item.localTime}`, reviewRequired: true as const,
    publishingSupported: item.format !== 'story', holdCode: item.format === 'story' ? 'story-publication-unsupported' as const : null })))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.brand.localeCompare(b.brand) || a.platform.localeCompare(b.platform));
}
/** Partition only. Retain existing objects/IDs/status/approval/bindings; never shift or delete later ideas. */
export function partitionMarketingBacklog<T extends { id: string; date: string | null }>(entries: readonly T[], window: MarketingWeekWindow) {
  if (entries.length > 1000) throw new Error('marketing-calendar-too-large');
  const verified = sevenDayMarketingWindow(window.startDate);
  if (window.endDateExclusive !== verified.endDateExclusive || window.timeZone !== verified.timeZone) throw new Error('invalid-marketing-window');
  const ids = new Set<string>(), upcoming: T[] = [], backlog: T[] = [], history: T[] = [], unscheduled: T[] = [];
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) throw new Error('duplicate-or-missing-calendar-id');
    ids.add(entry.id);
    if (entry.date === null) { unscheduled.push(entry); continue; }
    z.iso.date().parse(entry.date);
    if (entry.date < verified.startDate) history.push(entry);
    else if (entry.date >= verified.endDateExclusive) backlog.push(entry);
    else upcoming.push(entry);
  }
  return { window: verified, upcoming, backlog, history, unscheduled };
}
