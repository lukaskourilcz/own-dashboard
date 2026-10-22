import { z } from 'zod';

export const DNESKAI_COLLECTION_VERSION = 'dneskai-collection/1' as const;
export const DNESKAI_DAILY_TARGET = 4;
export const DneskaiSourceSchema = z.strictObject({
  id: z.string().min(1).max(100), name: z.string().min(1).max(120), url: z.url(),
  kind: z.enum(['instagram', 'rss', 'html', 'hn', 'arxiv', 'bluesky', 'spaceflight', 'github', 'stackexchange']),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), maxItems: z.number().int().min(1).max(20),
});
export type DneskaiSource = z.infer<typeof DneskaiSourceSchema>;
export const DneskaiCandidateSchema = z.strictObject({
  targetDate: z.iso.date().nullable(), id: z.string().min(1).max(200), sourceId: z.string().min(1).max(100), externalId: z.string().min(1).max(300),
  title: z.string().max(500), text: z.string().max(12000), url: z.url(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(), fetchedAt: z.iso.datetime({ offset: true }),
  // publishedAt is an upper bound (fetch time for an undated item, end of a stated day/month otherwise).
  dateEstimated: z.literal(true).optional(),
  mediaUrls: z.array(z.url()).max(10), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  // Instagram only, optional and additive (candidates before #114 lack it): the post owner's handle (the
  // source profile, or the collaborator who owns a documented co-author post) for the photo credit, and the
  // item type, so a Reel's caption is never read as a transcript of the video.
  instagram: z.strictObject({
    ownerUsername: z.string().regex(/^[A-Za-z0-9_.]{1,30}$/).optional(),
    mediaType: z.enum(['image', 'carousel', 'video']).optional(),
    containsVideo: z.literal(true).optional(),
  }).optional(),
  category: z.enum(['ai-news', 'tech-news', 'marketing', 'tool', 'ai-project', 'other']).nullable(),
  relevance: z.number().min(0).max(1).nullable(), duplicateOf: z.string().max(200).nullable(),
  status: z.enum(['new', 'held', 'duplicate', 'rejected', 'selected']), reason: z.string().max(200).nullable(),
});
export type DneskaiCandidate = z.infer<typeof DneskaiCandidateSchema>;
export const DneskaiSourceStateSchema = z.strictObject({
  sourceId: z.string(), lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
  lastAttemptAt: z.iso.datetime({ offset: true }).nullable(), status: z.enum(['never', 'ok', 'partial', 'error', 'held']),
  errorCode: z.string().nullable(), itemCount: z.number().int().nonnegative(), costUsd: z.number().nonnegative().nullable(),
});
/**
 * One news event as the owner sees it (#115): its reports with the chosen primary first, why it was selected,
 * held or treated as a duplicate, and, for a selected event, its brief. Browser-safe.
 */
export const DneskaiEventMemberViewSchema = z.strictObject({
  candidateId: z.string().min(1).max(200), sourceId: z.string().min(1).max(100), title: z.string().max(500), url: z.url(),
  status: z.enum(['new', 'held', 'duplicate', 'rejected', 'selected']), reason: z.string().max(200).nullable(), role: z.enum(['primary', 'supporting']),
});
export const DneskaiEventViewSchema = z.strictObject({
  eventId: z.string().min(1).max(200), targetDate: z.iso.date().nullable(),
  status: z.enum(['selected', 'held', 'duplicate', 'rejected', 'new']), reason: z.string().max(200).nullable(),
  brief: z.strictObject({
    id: z.uuid(), rank: z.number().int().min(1).max(4), status: z.enum(['pending', 'ready', 'queued', 'skipped']), code: z.string().max(64).nullable(),
    scheduledAt: z.iso.datetime({ offset: true }).nullable(), suggestedFormat: z.enum(['carousel', 'single-image']).nullable(),
    evidenceCount: z.number().int().min(0).max(30), mediaCount: z.number().int().min(0).max(30), jobId: z.uuid().nullable(),
  }).nullable(),
  members: z.array(DneskaiEventMemberViewSchema).min(1).max(30),
  // SEL-05, additive: for an event that was not selected, what the stored lead report says about it. `code` names
  // the first selection rule it fails (only for an open, status `new` event; null when the data cannot tell).
  selection: z.strictObject({
    code: z.enum(['selection-unclassified', 'selection-off-topic', 'selection-below-floor', 'selection-outside-window', 'selection-not-picked', 'selection-not-picked-relevance']).nullable(),
    category: DneskaiCandidateSchema.shape.category, relevance: z.number().min(0).max(1).nullable(),
    publishedAt: z.iso.datetime({ offset: true }).nullable(), dateEstimated: z.literal(true).optional(),
  }).optional(),
});
export type DneskaiEventSelection = NonNullable<z.infer<typeof DneskaiEventViewSchema>['selection']>;
export type DneskaiEventView = z.infer<typeof DneskaiEventViewSchema>;
export const DNESKAI_BRIEFS_READ_VERSION = 'dneskai-briefs/1' as const;
export const DneskaiBriefsReadSchema = z.strictObject({ schemaVersion: z.literal(DNESKAI_BRIEFS_READ_VERSION), events: z.array(DneskaiEventViewSchema).max(60) });
export type DneskaiBriefsRead = z.infer<typeof DneskaiBriefsReadSchema>;

export const DneskaiCollectionStateSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_COLLECTION_VERSION), timeZone: z.literal('Europe/Prague'), localTime: z.literal('22:00'),
  dailyTarget: z.literal(4), approvalRequired: z.literal(true), enabled: z.boolean(), blockers: z.array(z.string()),
  sources: z.array(DneskaiSourceSchema), sourceStates: z.array(DneskaiSourceStateSchema),
  candidates: z.array(DneskaiCandidateSchema).max(200),
  runs: z.array(z.strictObject({ id: z.string(), date: z.iso.date(), targetDate: z.iso.date(),
    status: z.enum(['running', 'complete', 'partial', 'held', 'failed']), selectedCount: z.number().int().min(0).max(4),
    costUsd: z.number().nonnegative().nullable(), errorCode: z.string().nullable() })).max(14),
  /** Selected events with their briefs, then other recent events (#115). Absent from responses before #115. */
  events: z.array(DneskaiEventViewSchema).max(60).optional(),
  /** Which owner recovery actions the deployment can perform (C3, briefs-07). Absent from older responses: none. */
  recovery: z.strictObject({ retry: z.boolean(), reslot: z.boolean(), heldRelease: z.boolean(), lapsedRelease: z.boolean() }).optional(),
});
export type DneskaiCollectionState = z.infer<typeof DneskaiCollectionStateSchema>;

/** Native OwnDashboard adapters or the compatible signed bridge return research candidates, never approved SourcePackets. */
export const DneskaiFeedRequestSchema = z.strictObject({
  action: z.literal('collect'), sourceIds: z.array(z.string().max(100)).min(1).max(8),
  since: z.iso.datetime({ offset: true }), maxItems: z.number().int().min(1).max(20),
});
export const DneskaiFeedResponseSchema = z.strictObject({
  schemaVersion: z.literal('dneskai-feed/1'), sources: z.array(z.strictObject({
    sourceId: z.string(), status: z.enum(['ok', 'partial', 'error']), errorCode: z.string().nullable(),
    items: z.array(z.strictObject({ externalId: z.string(), title: z.string().max(500), url: z.url(),
      publishedAt: z.iso.datetime({ offset: true }).nullable(), summary: z.string().max(2000), fetchedAt: z.iso.datetime({ offset: true }),
      // Optional and additive: the Quorum bridge omits both, so dneskai-feed/1 stays compatible.
      // imageUrl is a reference the adapter saw for free (RSS media, card image, og:image); nothing downloads it.
      imageUrl: z.url().max(2048).optional(),
      // publishedAt is an upper bound derived from a day/month without a time of day.
      dateEstimated: z.literal(true).optional() })).max(20),
  })).max(8),
});
