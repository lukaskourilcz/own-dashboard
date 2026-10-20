import { z } from "zod";

export const MARKETING_SOURCE_VERSION = "marketing-source/1";
export const MARKETING_CONTENT_VERSION = "marketing-content/1";
export const MARKETING_APPROVAL_VERSION = "marketing-approval/1";
export const MARKETING_PUBLICATION_VERSION = "marketing-publication/1";
export const BrandSchema = z.enum(["dneskai", "devshark"]);
export const PlatformSchema = z.enum(["instagram", "threads"]);
const id = z.string().min(1).max(200);
const timestamp = z.iso.datetime({ offset: true });
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

export const EvidenceSchema = z.strictObject({
  url: httpsUrl,
  title: z.string().min(1).max(300),
  excerpt: z.string().max(2000),
  checkedAt: timestamp,
  timecodeSeconds: z.number().nonnegative().optional(),
});

/** The producer supplies authored content, never credentials or learner data. */
export const SourcePacketSchema = z.strictObject({
  schemaVersion: z.literal(MARKETING_SOURCE_VERSION),
  brand: BrandSchema,
  kind: z.enum(["article", "question", "coding-task", "instagram-reference"]),
  sourceId: id,
  sourceRevision: id,
  contentHash: hash,
  canonicalUrl: httpsUrl,
  locale: z.enum(["cs", "en"]),
  observedAt: timestamp,
  expiresAt: timestamp.nullable(),
  eligible: z.boolean(),
  eligibilityReason: z.string().max(300),
  content: z.strictObject({
    title: z.string().min(1).max(300),
    body: z.string().min(1).max(30000),
    category: z.string().max(100),
    difficulty: z.string().max(50).nullable(),
    code: z.string().max(12000).nullable(),
    options: z.array(z.string().max(2000)).max(10),
    answer: z.string().max(6000).nullable(),
    explanation: z.string().max(12000).nullable(),
    evidence: z.array(EvidenceSchema).max(30),
    image: z.strictObject({ url: httpsUrl, alt: z.string().max(1000), licence: z.string().min(1).max(500) }).nullable(),
  }),
});
export type SourcePacket = z.infer<typeof SourcePacketSchema>;

export function parseSourcePacket(value: unknown): SourcePacket {
  const packet = SourcePacketSchema.parse(value);
  if ((packet.kind === "article" && packet.brand !== "dneskai") ||
      (["question", "coding-task"].includes(packet.kind) && packet.brand !== "devshark")) {
    throw new Error("Source kind does not belong to this brand.");
  }
  if (packet.brand === "dneskai" && packet.locale !== "cs") throw new Error("DNESKAi sources must be Czech.");
  if (packet.brand === "devshark" && packet.locale !== "en") throw new Error("devShark sources must be English.");
  if (packet.kind === "question" && (packet.content.options.length < 2 || !packet.content.answer || !packet.content.explanation)) {
    throw new Error("A question requires options and an authored answer and explanation.");
  }
  if (packet.kind === "article" && !packet.content.evidence.length) throw new Error("An article requires source evidence.");
  return packet;
}

export const AssetSchema = z.strictObject({
  url: httpsUrl,
  sha256: hash,
  mimeType: z.enum(["image/jpeg", "video/mp4"]),
  width: z.number().int().positive().max(7680),
  height: z.number().int().positive().max(7680),
  alt: z.string().max(1000),
});
export const ContentRevisionSchema = z.strictObject({
  schemaVersion: z.literal(MARKETING_CONTENT_VERSION),
  brand: BrandSchema,
  title: z.string().min(1).max(300),
  caption: z.string().min(1).max(2200),
  format: z.enum(["carousel", "post", "reel", "thread", "story"]),
  sources: z.array(z.strictObject({ sourceId: id, sourceRevision: id, contentHash: hash })).min(1).max(20),
  knowledgeIds: z.array(z.uuid()).max(30),
  assets: z.array(AssetSchema).max(10),
  account: z.strictObject({ id, platform: PlatformSchema, handle: z.string().min(1).max(100) }),
  /** Instagram co-authors invited on the post. Present only when a revision records a documented collaboration. */
  collaborators: z.array(z.string().regex(/^[A-Za-z0-9._]{1,30}$/)).min(1).max(3).optional(),
  scheduledAt: timestamp,
  timeZone: z.literal("Europe/Prague"),
  templateVersion: id,
  promptVersion: id,
  model: id,
  traceId: z.uuid().nullable(),
});
export type ContentRevision = z.infer<typeof ContentRevisionSchema>;
export type MarketingBrand = z.infer<typeof BrandSchema>;

/** Portable owner decision. Authentication and the atomic stored-revision gate remain mandatory. */
export const ApprovalDecisionSchema = z.strictObject({
  schemaVersion: z.literal(MARKETING_APPROVAL_VERSION),
  revisionId: z.uuid(),
  revisionHash: hash,
  decision: z.enum(["approved", "returned", "skipped"]),
  decidedAt: timestamp,
  feedback: z.string().max(2000).nullable(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export function parseApprovalDecision(value: unknown, expected?: { revisionId: string; revisionHash: string }): ApprovalDecision {
  const decision = ApprovalDecisionSchema.parse(value);
  if (expected && (decision.revisionId !== expected.revisionId || decision.revisionHash !== expected.revisionHash)) throw new Error("approval-revision-mismatch");
  return decision;
}

const remoteId = id.regex(/^\S+$/);
const receiptUrl = httpsUrl.regex(/^https:\/\/[^/?#\s@]+(?:[/?#][^\s]*)?$/);
const receiptError = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/);
const receiptFields = {
  schemaVersion: z.literal(MARKETING_PUBLICATION_VERSION),
  publicationId: z.uuid(),
  revisionId: z.uuid(),
  revisionHash: hash,
  platform: PlatformSchema,
  observedAt: timestamp,
};
/** State-specific receipts preserve ambiguous remote evidence without claiming a completed publication. */
export const PublicationReceiptSchema = z.union([
  z.strictObject({ ...receiptFields, status: z.literal("queued"), remoteContainerId: z.null(), remoteMediaId: z.null(), remoteUrl: z.null(), errorCode: z.null() }),
  z.strictObject({ ...receiptFields, status: z.literal("claimed"), remoteContainerId: remoteId.nullable(), remoteMediaId: z.null(), remoteUrl: z.null(), errorCode: receiptError.nullable() }),
  z.strictObject({ ...receiptFields, status: z.literal("published"), remoteContainerId: remoteId.nullable(), remoteMediaId: remoteId, remoteUrl: receiptUrl, errorCode: z.null() }),
  z.strictObject({ ...receiptFields, status: z.literal("failed"), remoteContainerId: remoteId.nullable(), remoteMediaId: z.null(), remoteUrl: z.null(), errorCode: receiptError }),
  z.strictObject({ ...receiptFields, status: z.literal("reconciliation"), remoteContainerId: remoteId.nullable(), remoteMediaId: z.null(), remoteUrl: z.null(), errorCode: receiptError }),
  z.strictObject({ ...receiptFields, status: z.literal("reconciliation"), remoteContainerId: remoteId.nullable(), remoteMediaId: remoteId, remoteUrl: receiptUrl.nullable(), errorCode: receiptError }),
  z.strictObject({ ...receiptFields, status: z.literal("cancelled"), remoteContainerId: z.null(), remoteMediaId: z.null(), remoteUrl: z.null(), errorCode: receiptError.nullable() }),
]);
export type PublicationReceipt = z.infer<typeof PublicationReceiptSchema>;
export function parsePublicationReceipt(value: unknown, expected?: { publicationId: string; revisionId: string; revisionHash: string; platform: z.infer<typeof PlatformSchema> }): PublicationReceipt {
  const receipt = PublicationReceiptSchema.parse(value);
  if (expected && (receipt.publicationId !== expected.publicationId || receipt.revisionId !== expected.revisionId || receipt.revisionHash !== expected.revisionHash || receipt.platform !== expected.platform)) throw new Error("receipt-publication-mismatch");
  return receipt;
}

/** Parsing proves shape; readiness is a separate, stricter publication gate. */
export function parseContentRevision(value: unknown): ContentRevision {
  return ContentRevisionSchema.parse(value);
}
export function revisionReadiness(revision: ContentRevision): string[] {
  const issues: string[] = [];
  if (revision.account.platform === "instagram" && revision.assets.length === 0) issues.push("missing-assets");
  if (revision.format === "carousel" && revision.assets.length < 2) issues.push("carousel-needs-two-assets");
  if (revision.format === "reel" && !revision.assets.some((asset) => asset.mimeType === "video/mp4")) issues.push("missing-video");
  if (revision.format === "story") {
    if (revision.account.platform !== "instagram") issues.push("story-instagram-required");
    if (revision.assets.length !== 1 || revision.assets[0]?.mimeType !== "image/jpeg") issues.push("story-single-jpeg-required");
    else if (revision.assets[0].width !== 1080 || revision.assets[0].height !== 1920) issues.push("story-image-dimensions-required");
  }
  if (revision.account.platform === "threads" && revision.caption.length > 500) issues.push("threads-caption-too-long");
  return issues;
}

export type MarketingRevisionRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  campaign_id: string | null;
  revision: ContentRevision;
  content_hash: string;
  ready: boolean;
  status: "review" | "approved" | "publishing" | "published" | "failed" | "reconciliation" | "returned" | "skipped" | "superseded";
  approved_at: string | null;
  approved_hash: string | null;
  feedback: string | null;
  created_at: string;
};

export type PublicationRow = {
  id: string; revision_id: string; platform: "instagram" | "threads";
  status: "queued" | "claimed" | "published" | "failed" | "reconciliation" | "cancelled";
  remote_container_id: string | null; remote_media_id: string | null;
  remote_url: string | null; error_code: string | null;
};

/** An acknowledged Story need not have a permanent public URL. This narrow
 * classifier does not grant publication authority or infer an acknowledgement. */
export function publishedStoryReceipt(revision: { format?: string; account: { platform: string } },
  receipt: { status: string; platform: string; remote_media_id: string | null; remote_url: string | null }): boolean {
  if (revision.format !== "story" || revision.account.platform !== "instagram" || receipt.platform !== "instagram" || receipt.status !== "published" ||
      !receipt.remote_media_id || !/^[1-9]\d{0,99}$/.test(receipt.remote_media_id)) return false;
  if (receipt.remote_url === null) return true;
  try { const url = new URL(receipt.remote_url); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}

export function sourceUsable(packet: SourcePacket, now = new Date()): boolean {
  return packet.eligible && (packet.expiresAt === null || Date.parse(packet.expiresAt) > now.getTime());
}

/** Stable object-key ordering shared by producer hashes and approval bindings. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}
