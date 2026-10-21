import { z } from "zod";

/**
 * The DNESKAi social brief (#115): one selected news event, its best source, supporting evidence and the
 * stored source media, ready for a single structured generation call (#116). A brief replaces the approved
 * BoardlessAI article as the input of a DNESKAi social post. Research selection is not fact verification and
 * not approval; the owner still approves the exact rendered revision.
 */
export const DNESKAI_BRIEF_VERSION = "dneskai-brief/1";

const id = z.string().min(1).max(200);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);

export const DneskaiBriefCategorySchema = z.enum(["ai-news", "tech-news", "marketing", "tool", "ai-project"]);
export type DneskaiBriefCategory = z.infer<typeof DneskaiBriefCategorySchema>;

export const DneskaiBriefEvidenceSchema = z.strictObject({
  candidateId: id,
  sourceId: id,
  url: httpsUrl,
  title: z.string().min(1).max(500),
  /** Source text as collected (feed summary or Instagram caption), not a transcript. */
  excerpt: z.string().max(4000),
  publishedAt: timestamp.nullable(),
  dateEstimated: z.boolean(),
  /** True for an Instagram Reel or video whose only text is its caption. Never present it as speech. */
  captionOnly: z.boolean(),
});
export type DneskaiBriefEvidence = z.infer<typeof DneskaiBriefEvidenceSchema>;

export const DneskaiBriefMediaSchema = z.strictObject({
  assetSha256: sha256,
  candidateId: id,
  /** Order inside the original post or article, starting at 0. */
  position: z.number().int().min(0).max(99),
  credit: z.string().min(1).max(120),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
  originKind: z.enum(["instagram-display", "instagram-child", "og-image", "article-figure", "feed-image"]),
  /** Shorter side >= 900 px: may fill a cover-photo or single photo slide (the studio still checks the crop). */
  fullBleedCapable: z.boolean(),
  /** Width >= 600 px: may be shown framed (figure, split, sources thumbnails). */
  insetCapable: z.boolean(),
});
export type DneskaiBriefMedia = z.infer<typeof DneskaiBriefMediaSchema>;

export const DneskaiBriefSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_BRIEF_VERSION),
  eventId: id,
  /** sha256 over the sorted member candidate ids and their content hashes; changes when the event changes. */
  memberHash: sha256,
  targetDate: z.iso.date(),
  category: DneskaiBriefCategorySchema,
  title: z.string().min(1).max(300),
  /** The chosen primary source first, then supporting reports of the same event. */
  evidence: z.array(DneskaiBriefEvidenceSchema).min(1).max(30),
  media: z.array(DneskaiBriefMediaSchema).max(30),
  /** Suggested by #115 from text length and media; generation may only move carousel -> single-image, never invent media. */
  suggestedFormat: z.enum(["carousel", "single-image"]),
  scheduledAt: timestamp,
  timeZone: z.literal("Europe/Prague"),
  observedAt: timestamp,
  expiresAt: timestamp,
}).superRefine((brief, context) => {
  const candidates = new Set(brief.evidence.map((item) => item.candidateId));
  brief.media.forEach((item, index) => {
    if (!candidates.has(item.candidateId)) context.addIssue({ code: "custom", message: "media must belong to an evidence candidate", path: ["media", index, "candidateId"] });
  });
  if (new Set(brief.media.map((item) => item.assetSha256)).size !== brief.media.length) {
    context.addIssue({ code: "custom", message: "media assets must be distinct", path: ["media"] });
  }
  if (Date.parse(brief.expiresAt) <= Date.parse(brief.observedAt)) context.addIssue({ code: "custom", message: "brief expires before it was observed", path: ["expiresAt"] });
});
export type DneskaiBrief = z.infer<typeof DneskaiBriefSchema>;

/** The asset pool an edit or a generation may draw from. */
export function dneskaiBriefAssetHashes(brief: DneskaiBrief): string[] {
  return brief.media.map((item) => item.assetSha256);
}
