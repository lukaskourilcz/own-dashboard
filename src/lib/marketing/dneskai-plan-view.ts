import { z } from 'zod';

/**
 * The DNESKAi publishing plan as the owner reads it (owner decision, 7 November 2026): a rolling 30-day calendar of
 * slots, each one post for Instagram, Threads or both. Browser-safe: GET /api/marketing/dneskai/plan builds it
 * (dneskai-plan-read.ts) and the "Dnes a zítra" tab and the 30-day calendar validate it with these schemas.
 *
 * A slot holds either a news revision the owner approved into the plan or an approved education topic. The scheduler's
 * plan step (dneskai-plan.ts) renders the post in Spotlight, moves it to the slot's time, approves it and derives
 * its Threads twin. `labPostId` is the Instagram post (or the Threads-only post) the Design Lab edits.
 */
export const DNESKAI_PLAN_VIEW_VERSION = 'dneskai-plan/1';

/** Instagram posts three times a day; Threads repeats those three and adds an evening post of its own. */
export const DNESKAI_PLAN_INSTAGRAM_TIMES = ['08:00', '12:30', '19:00'] as const;
export const DNESKAI_PLAN_THREADS_ONLY_TIMES = ['21:00'] as const;
export const DNESKAI_PLAN_TIMES = [...DNESKAI_PLAN_INSTAGRAM_TIMES, ...DNESKAI_PLAN_THREADS_ONLY_TIMES] as const;
/**
 * Extra Instagram and Threads times (owner decision, 8 November 2026). The plan never fills them by itself; they hold
 * posts placed there on purpose and show in the plan only when they do.
 */
export const DNESKAI_PLAN_EXTRA_TIMES = ['10:00', '14:30'] as const;
/** Every time a slot may have, in the order of the day. */
export const DNESKAI_PLAN_ALL_TIMES = ['08:00', '10:00', '12:30', '14:30', '19:00', '21:00'] as const;
/** The plan reaches this many Prague days ahead, today included. */
export const DNESKAI_PLAN_DAYS = 30;
/** The read serves at most this many days in one request. */
export const DNESKAI_PLAN_READ_MAX_DAYS = 31;

export const DNESKAI_PLAN_STATUSES = ['planned', 'generating', 'ready', 'approved', 'published', 'skipped', 'failed'] as const;
export type DneskaiPlanStatus = (typeof DNESKAI_PLAN_STATUSES)[number];
export const DNESKAI_PLAN_KINDS = ['news', 'education'] as const;
export type DneskaiPlanKind = (typeof DNESKAI_PLAN_KINDS)[number];

const uuid = z.uuid();
const date = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timestamp = z.iso.datetime({ offset: true });
const code = z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/);
/** A signed https link from the private bucket, or a same-origin path in the deterministic preview. */
const imageUrl = z.string().max(4096).refine((value) => value.startsWith('https://') || /^\/[A-Za-z0-9/_.-]+$/.test(value), 'image url');
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);

export const DneskaiPlanSlideSchema = z.strictObject({
  url: imageUrl,
  alt: z.string().max(1000),
  width: z.number().int().positive().max(7680),
  height: z.number().int().positive().max(7680),
});
export type DneskaiPlanSlide = z.infer<typeof DneskaiPlanSlideSchema>;

/** One channel of a slot: the exact revision that will go out there, its text and where it stands. */
export const DneskaiPlanChannelSchema = z.strictObject({
  revisionId: uuid.nullable(),
  /** The text the platform receives: the Instagram caption, or the Threads text (at most 500 characters). */
  caption: z.string().max(2200).nullable(),
  format: z.enum(['carousel', 'post', 'reel', 'thread', 'story']).nullable(),
  revisionStatus: z.string().max(40).nullable(),
  publicationStatus: z.enum(['queued', 'claimed', 'published', 'failed', 'reconciliation', 'cancelled']).nullable(),
  remoteUrl: httpsUrl.nullable(),
  errorCode: code.nullable(),
});
export type DneskaiPlanChannel = z.infer<typeof DneskaiPlanChannelSchema>;

export const DneskaiPlanSlotSchema = z.strictObject({
  id: uuid,
  date,
  time,
  scheduledAt: timestamp,
  kind: z.enum(DNESKAI_PLAN_KINDS),
  status: z.enum(DNESKAI_PLAN_STATUSES),
  code: code.nullable(),
  title: z.string().min(1).max(300),
  /** The Spotlight kit, or the older kit a news post still carries until the plan step re-renders it. */
  kit: z.string().max(40).nullable(),
  /** The post's rendered slides in order; empty while the post is still being generated or rendered. */
  slides: z.array(DneskaiPlanSlideSchema).max(10),
  /** The revision the Design Lab opens (`?projectTab=dneskai-review&labPost=…`); null before generation. */
  labPostId: uuid.nullable(),
  instagram: DneskaiPlanChannelSchema.nullable(),
  threads: DneskaiPlanChannelSchema.nullable(),
  /** The Instagram story made from the post's cover, ten minutes after it (7 November 2026). */
  story: DneskaiPlanChannelSchema.nullable().optional(),
});
export type DneskaiPlanSlot = z.infer<typeof DneskaiPlanSlotSchema>;

export const DneskaiPlanReadSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_PLAN_VIEW_VERSION),
  generatedAt: timestamp,
  today: date,
  from: date,
  days: z.number().int().min(1).max(DNESKAI_PLAN_READ_MAX_DAYS),
  /** DNESKAI_PLAN_ENABLED: off, the scheduler leaves the plan alone and the read says so. */
  enabled: z.boolean(),
  accounts: z.strictObject({
    instagram: z.strictObject({ handle: z.string().min(1).max(100), enabled: z.boolean() }).nullable(),
    threads: z.strictObject({ handle: z.string().min(1).max(100), enabled: z.boolean() }).nullable(),
  }),
  slots: z.array(DneskaiPlanSlotSchema).max(DNESKAI_PLAN_READ_MAX_DAYS * DNESKAI_PLAN_ALL_TIMES.length),
});
export type DneskaiPlanRead = z.infer<typeof DneskaiPlanReadSchema>;

/** The days of a read in order, each with its slots by time; a day without a slot still appears. */
export function dneskaiPlanDays(read: Pick<DneskaiPlanRead, 'from' | 'days' | 'slots'>): Array<{ date: string; slots: DneskaiPlanSlot[] }> {
  return Array.from({ length: read.days }, (_, index) => {
    const day = new Date(Date.parse(`${read.from}T12:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10);
    return { date: day, slots: read.slots.filter((slot) => slot.date === day).sort((a, b) => a.time.localeCompare(b.time)) };
  });
}

/** Instagram and Threads posts a day of the plan holds. */
export function dneskaiPlanDayCounts(slots: readonly Pick<DneskaiPlanSlot, 'instagram' | 'threads' | 'status'>[]): { instagram: number; threads: number } {
  const live = slots.filter((slot) => slot.status !== 'skipped');
  return { instagram: live.filter((slot) => slot.instagram).length, threads: live.filter((slot) => slot.threads).length };
}
