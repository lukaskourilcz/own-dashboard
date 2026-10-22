import { z } from 'zod';

/**
 * DNESKAi topics (náměty, #150, plan A1): a working title the owner approves or rejects before the pipeline pays for
 * enrichment, pictures or generation. Browser-safe: GET /api/marketing/dneskai/topics builds the read
 * (readDneskaiTopics in dneskai-workspace-read.ts) and the client validates it with these schemas; POST takes
 * DneskaiTopicActionSchema. Everything sits behind the server-only DNESKAI_TOPICS_ENABLED.
 */
export const DNESKAI_TOPICS_VERSION = 'dneskai-topics/1';
export const DNESKAI_TOPIC_KINDS = ['news', 'education'] as const;
export const DNESKAI_TOPIC_SOURCE_KINDS = ['feed', 'instagram', 'library', 'manual'] as const;
export const DNESKAI_TOPIC_VERDICTS = ['fact', 'hype', 'unclear'] as const;
export const DNESKAI_TOPIC_STATUSES = ['proposed', 'approved', 'rejected', 'expired', 'enriching', 'briefed', 'generated'] as const;
export type DneskaiTopicKind = (typeof DNESKAI_TOPIC_KINDS)[number];
export type DneskaiTopicStatus = (typeof DNESKAI_TOPIC_STATUSES)[number];
/** Statuses the owner sees behind the "rejected and expired" disclosure, with a restore action. */
export const DNESKAI_TOPIC_ARCHIVED_STATUSES = ['rejected', 'expired'] as const satisfies readonly DneskaiTopicStatus[];

/** The SQL limits of marketing_dneskai_topics (20261023100000). */
export const DNESKAI_TOPIC_TITLE_MAX = 160;
export const DNESKAI_TOPIC_KEYWORD = /^[A-Za-z]{2,24}$/;

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
const title = z.string().trim().min(1).max(DNESKAI_TOPIC_TITLE_MAX);
const keyword = z.string().regex(DNESKAI_TOPIC_KEYWORD);

export const DneskaiTopicSchema = z.strictObject({
  id: uuid,
  kind: z.enum(DNESKAI_TOPIC_KINDS),
  sourceKind: z.enum(DNESKAI_TOPIC_SOURCE_KINDS),
  /** Where it came from: a domain, an Instagram handle or nothing (a manual title). */
  source: z.strictObject({ label: z.string().min(1).max(120).nullable(), url: httpsUrl.nullable() }),
  title,
  summary: z.string().max(600).nullable(),
  keyword: keyword.nullable(),
  verdict: z.enum(DNESKAI_TOPIC_VERDICTS).nullable(),
  status: z.enum(DNESKAI_TOPIC_STATUSES),
  proposedFor: z.iso.date(),
  approvedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type DneskaiTopic = z.infer<typeof DneskaiTopicSchema>;

const statusGroups = z.strictObject(Object.fromEntries(DNESKAI_TOPIC_STATUSES.map((status) => [status, z.array(DneskaiTopicSchema).max(120)])) as Record<DneskaiTopicStatus, z.ZodArray<typeof DneskaiTopicSchema>>);

export const DneskaiTopicsReadSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_TOPICS_VERSION),
  generatedAt: timestamp,
  /** Topics by kind, then by status; each list newest first. */
  groups: z.strictObject({ news: statusGroups, education: statusGroups }),
  /** When the pipeline last proposed a topic (manual topics excluded); null before the first one. */
  lastProposedAt: timestamp.nullable(),
  /** Stored rows that could not be read; shown as a count, never a failed read. */
  unreadable: z.number().int().nonnegative(),
});
export type DneskaiTopicsRead = z.infer<typeof DneskaiTopicsReadSchema>;

/** Empty status lists for one kind. */
export const emptyDneskaiTopicGroups = (): Record<DneskaiTopicStatus, DneskaiTopic[]> =>
  Object.fromEntries(DNESKAI_TOPIC_STATUSES.map((status) => [status, []])) as unknown as Record<DneskaiTopicStatus, DneskaiTopic[]>;

/** Owner actions. approve, reject and restore take up to 40 topics at once ("Schválit vybrané"). */
export const DneskaiTopicActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.enum(['approve', 'reject', 'restore']), projectId: uuid, topicIds: z.array(uuid).min(1).max(40) }),
  z.strictObject({ action: z.literal('edit'), projectId: uuid, topicId: uuid, title, keyword: keyword.nullable() }),
  z.strictObject({ action: z.literal('create'), projectId: uuid, kind: z.enum(DNESKAI_TOPIC_KINDS), title: title.optional(), url: httpsUrl.optional(), keyword: keyword.optional() })
    .refine((input) => input.title !== undefined || input.url !== undefined, 'title or url'),
]);
export type DneskaiTopicAction = z.infer<typeof DneskaiTopicActionSchema>;

export const DneskaiTopicActionResultSchema = z.strictObject({
  ok: z.literal(true),
  results: z.array(z.union([
    z.strictObject({ id: uuid, status: z.enum(DNESKAI_TOPIC_STATUSES) }),
    z.strictObject({ id: uuid, error: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) }),
  ])).max(40),
});
export type DneskaiTopicActionResult = z.infer<typeof DneskaiTopicActionResultSchema>;
