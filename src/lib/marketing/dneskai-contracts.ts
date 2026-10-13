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
  mediaUrls: z.array(z.url()).max(20), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
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
export const DneskaiCollectionStateSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_COLLECTION_VERSION), timeZone: z.literal('Europe/Prague'), localTime: z.literal('22:00'),
  dailyTarget: z.literal(4), approvalRequired: z.literal(true), enabled: z.boolean(), blockers: z.array(z.string()),
  sources: z.array(DneskaiSourceSchema), sourceStates: z.array(DneskaiSourceStateSchema),
  candidates: z.array(DneskaiCandidateSchema).max(200),
  runs: z.array(z.strictObject({ id: z.string(), date: z.iso.date(), targetDate: z.iso.date(),
    status: z.enum(['running', 'complete', 'partial', 'held', 'failed']), selectedCount: z.number().int().min(0).max(4),
    costUsd: z.number().nonnegative().nullable(), errorCode: z.string().nullable() })).max(14),
});
export type DneskaiCollectionState = z.infer<typeof DneskaiCollectionStateSchema>;

/** Quorum reuses its existing adapters; candidates are research, never approved SourcePackets. */
export const DneskaiFeedRequestSchema = z.strictObject({
  action: z.literal('collect'), sourceIds: z.array(z.string().max(100)).min(1).max(8),
  since: z.iso.datetime({ offset: true }), maxItems: z.number().int().min(1).max(20),
});
export const DneskaiFeedResponseSchema = z.strictObject({
  schemaVersion: z.literal('dneskai-feed/1'), sources: z.array(z.strictObject({
    sourceId: z.string(), status: z.enum(['ok', 'partial', 'error']), errorCode: z.string().nullable(),
    items: z.array(z.strictObject({ externalId: z.string(), title: z.string().max(500), url: z.url(),
      publishedAt: z.iso.datetime({ offset: true }).nullable(), summary: z.string().max(2000), fetchedAt: z.iso.datetime({ offset: true }) })).max(20),
  })).max(8),
});
