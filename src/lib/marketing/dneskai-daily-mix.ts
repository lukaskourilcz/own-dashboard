import { z } from 'zod';
import { databaseTimestamp } from '@/lib/database-version';

/**
 * The DNESKAi daily mix (#156, plan A7): the number of news and education posts the owner wants a day and the active
 * publishing times. Browser-safe: GET/PUT /api/marketing/dneskai/daily-mix use these schemas, and the server reads
 * the mix (`readDneskaiDailyMix` in dneskai-daily-mix-read.ts) when it picks topics and slots. No stored row means
 * the default. The four times are `DNESKAI_BRIEF_SLOTS`; the mix only switches some of them off.
 */
export const DNESKAI_DAILY_MIX_TIMES = ['08:00', '12:30', '17:00', '20:00'] as const;
export type DneskaiDailyMixTime = (typeof DNESKAI_DAILY_MIX_TIMES)[number];

export const DneskaiDailyMixSchema = z.strictObject({
  newsPerDay: z.number().int().min(0).max(4),
  educationPerDay: z.number().int().min(0).max(4),
  slots: z.array(z.enum(DNESKAI_DAILY_MIX_TIMES)).min(1).max(4),
}).superRefine((mix, context) => {
  if (new Set(mix.slots).size !== mix.slots.length) context.addIssue({ code: 'custom', message: 'slots must be distinct', path: ['slots'] });
  if (mix.newsPerDay + mix.educationPerDay > mix.slots.length) context.addIssue({ code: 'custom', message: 'every post needs its own time', path: ['slots'] });
});
export type DneskaiDailyMix = z.infer<typeof DneskaiDailyMixSchema>;

export const DEFAULT_DNESKAI_DAILY_MIX: DneskaiDailyMix = Object.freeze({ newsPerDay: 1, educationPerDay: 1, slots: ['08:00', '17:00'] }) as DneskaiDailyMix;

/** The active times in the day's order, whatever order they were saved in. */
export function dneskaiActiveSlotTimes(mix: Pick<DneskaiDailyMix, 'slots'>): DneskaiDailyMixTime[] {
  return DNESKAI_DAILY_MIX_TIMES.filter((time) => mix.slots.includes(time));
}

/** The titling and news selection offer three titles for each post the owner wants (at least three). */
export const DNESKAI_TITLES_PER_POST = 3;
export function dneskaiNewsTopicLimit(mix: Pick<DneskaiDailyMix, 'newsPerDay'>): number {
  return mix.newsPerDay * DNESKAI_TITLES_PER_POST;
}

export const DneskaiDailyMixReadSchema = z.strictObject({ mix: DneskaiDailyMixSchema, stored: z.boolean(), version: databaseTimestamp.nullable() })
  .refine(read => read.stored === (read.version !== null));
export type DneskaiDailyMixRead = z.infer<typeof DneskaiDailyMixReadSchema>;
export const DneskaiDailyMixSaveSchema = z.strictObject({ mix: DneskaiDailyMixSchema, expectedVersion: databaseTimestamp.nullable() });
export const DneskaiDailyMixReceiptSchema = z.strictObject({ kind: z.enum(['saved', 'conflict']), projectId: z.uuid(), ownerId: z.uuid(),
  sourceVersion: databaseTimestamp.nullable(), read: DneskaiDailyMixReadSchema }).refine(receipt => receipt.read.stored);
export type DneskaiDailyMixReceipt = z.infer<typeof DneskaiDailyMixReceiptSchema>;
export function sameDneskaiDailyMix(a: DneskaiDailyMix, b: DneskaiDailyMix): boolean {
  return a.newsPerDay === b.newsPerDay && a.educationPerDay === b.educationPerDay
    && a.slots.length === b.slots.length && a.slots.every((slot, index) => slot === b.slots[index]);
}
