import { z } from "zod";
import { TIP_GROUPS, tipText } from "@/lib/ig-tips";
import type { AiLink } from "@/lib/types";
import { contentHash } from "./hashes";

export const KNOWLEDGE_VERSION = "marketing-knowledge/1";
export const KNOWLEDGE_PROMPT_VERSION = "atomic-procedures/1";
const timestamp = z.iso.datetime({ offset: true });
const nullableText = z.string().max(30000).nullable();
export const EvidenceSegmentSchema = z.strictObject({ text: z.string().min(1).max(12000), startSeconds: z.number().nonnegative().nullable(), endSeconds: z.number().nonnegative().nullable() })
  .refine((s) => (s.startSeconds === null && s.endSeconds === null) || (s.startSeconds !== null && s.endSeconds !== null && s.endSeconds >= s.startSeconds), "Invalid timecodes");
export const MediaEvidenceSchema = z.strictObject({
  status: z.enum(["available", "unavailable", "failed", "not-requested"]), provider: z.string().max(120).nullable(),
  costUsd: z.number().nonnegative().nullable(), segments: z.array(EvidenceSegmentSchema).max(100), reason: z.string().max(300).nullable(),
}).refine((m) => m.status === "available" ? !!m.provider && m.segments.length > 0 : m.segments.length === 0, "Evidence status does not match available text");
export type MediaEvidence = z.infer<typeof MediaEvidenceSchema>;
export const unavailableMedia = (reason = "not-requested"): MediaEvidence => ({ status: "not-requested", provider: null, costUsd: null, segments: [], reason });
export const KnowledgeContentSchema = z.strictObject({ caption: nullableText, captionProvider: z.string().max(120).nullable(), transcript: MediaEvidenceSchema, ocr: MediaEvidenceSchema });
export type KnowledgeContent = z.infer<typeof KnowledgeContentSchema>;
export const KnowledgeSourceSchema = z.strictObject({
  shortcode: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), canonical_url: z.url({ protocol: /^https$/ }).max(2048),
  saved_at: timestamp.nullable(), saved_at_status: z.enum(["verified", "unverified", "unknown"]),
  published_at: timestamp.nullable(), imported_at: timestamp, cutoff: timestamp,
  content: KnowledgeContentSchema, status: z.enum(["captured", "partial", "inaccessible", "queued", "analyzing", "review", "failed", "cancelled"]),
  provenance: z.enum(["instagram-export", "manual", "apify", "existing-tip"]),
  analysis_key: z.string().regex(/^[a-f0-9]{64}$/).nullable(), budget_usd: z.number().min(0).max(1),
  run_id: z.string().max(100).nullable(), dataset_id: z.string().max(100).nullable(),
  analysis: z.strictObject({ model: z.string().max(100), promptVersion: z.string().max(100), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), costUsd: z.number().nonnegative(), missingParts: z.array(z.string().max(300)).max(30) }).nullable(),
});
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;
export type StoredKnowledgeSource = KnowledgeSource & { id: string; user_id: string };
export function instagramIdentity(value: string): { shortcode: string; canonicalUrl: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["instagram.com", "www.instagram.com", "m.instagram.com"].includes(url.hostname.toLowerCase())) return null;
    const match = /^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{1,80})\/?$/.exec(url.pathname);
    return match ? { shortcode: match[1], canonicalUrl: `https://www.instagram.com/p/${match[1]}/` } : null;
  } catch { return null; }
}
const normalizeDate = (value: unknown): string | null => {
  const parsed = timestamp.safeParse(value);
  return parsed.success ? new Date(parsed.data).toISOString() : null;
};
const epochDate = (value: unknown): string | null => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 4_102_444_800 ? new Date(value * 1000).toISOString() : null;
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const CaptureInputSchema = z.strictObject({
  cutoff: timestamp, input: z.unknown(), includeUnknownDates: z.boolean().default(false),
  timestampProof: z.strictObject({ url: z.string().max(2048), savedAt: timestamp }).nullable().default(null),
});
export type CaptureInput = z.input<typeof CaptureInputSchema>;
export type CaptureReport = { version: typeof KNOWLEDGE_VERSION; cutoff: string; startsAt: string; sources: KnowledgeSource[];
  counts: { received: number; unique: number; duplicates: number; outsideWindow: number; unknownDates: number; rejected: number };
  timestampVerified: boolean; warnings: string[] };
/** No scraping, model call or date inference occurs in capture. */
export function planKnowledgeCapture(value: CaptureInput, now = new Date()): CaptureReport {
  const input = CaptureInputSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(input.input)) > 1_000_000) throw new Error("capture-too-large");
  let data: unknown = input.input;
  if (typeof data === "string") {
    const trimmed = data.trim();
    data = trimmed.startsWith("[") || trimmed.startsWith("{") ? JSON.parse(trimmed) : trimmed.split(/\s+/).filter(Boolean).map((url) => ({ url }));
  }
  const root = obj(data);
  const rows = Array.isArray(data) ? data : Array.isArray(root.saved_saved_media) ? root.saved_saved_media : Array.isArray(root.items) ? root.items : null;
  if (!rows || rows.length > 500) throw new Error("unsupported-or-unbounded-export");
  const normalized = rows.map((raw) => {
    const r = obj(raw);
    const saved = obj(obj(r.string_map_data)["Saved on"]);
    const identity = instagramIdentity(String(r.url ?? saved.href ?? ""));
    if (!identity) return null;
    return { ...identity, savedAt: normalizeDate(r.saved_at) ?? epochDate(saved.timestamp),
      explicitSaved: normalizeDate(r.saved_at) !== null, exportedSaved: epochDate(saved.timestamp) !== null,
      publishedAt: normalizeDate(r.published_at), caption: typeof r.caption === "string" ? r.caption.slice(0, 30000) : null };
  });
  const proof = input.timestampProof && instagramIdentity(input.timestampProof.url);
  const timestampVerified = !!proof && normalized.some((r) => r?.shortcode === proof.shortcode && r.exportedSaved && r.savedAt === normalizeDate(input.timestampProof!.savedAt));
  if (input.timestampProof && !timestampVerified) throw new Error("saved-timestamp-proof-mismatch");
  const cutoff = new Date(input.cutoff).toISOString();
  const startsAt = new Date(Date.parse(cutoff) - 21 * 86400000).toISOString();
  const counts = { received: rows.length, unique: 0, duplicates: 0, outsideWindow: 0, unknownDates: 0, rejected: normalized.filter((r) => !r).length };
  const unique = new Map<string, KnowledgeSource>();
  for (const row of normalized) {
    if (!row) continue;
    if (unique.has(row.shortcode)) { counts.duplicates++; continue; }
    const verified = row.explicitSaved || (row.exportedSaved && timestampVerified);
    if (!verified) counts.unknownDates++;
    if (verified && row.savedAt && (row.savedAt < startsAt || row.savedAt >= cutoff)) { counts.outsideWindow++; continue; }
    if (!verified && !input.includeUnknownDates) continue;
    unique.set(row.shortcode, KnowledgeSourceSchema.parse({ shortcode: row.shortcode, canonical_url: row.canonicalUrl,
      saved_at: row.savedAt, saved_at_status: verified ? "verified" : row.savedAt ? "unverified" : "unknown",
      published_at: row.publishedAt, imported_at: now.toISOString(), cutoff,
      content: { caption: row.caption, captionProvider: row.caption ? "owner-provided" : null, transcript: unavailableMedia(), ocr: unavailableMedia() },
      status: row.caption ? "captured" : "partial", provenance: row.exportedSaved ? "instagram-export" : "manual",
      analysis_key: null, budget_usd: 0, run_id: null, dataset_id: null, analysis: null,
    }));
  }
  counts.unique = unique.size;
  return { version: KNOWLEDGE_VERSION, cutoff, startsAt, sources: [...unique.values()], counts, timestampVerified,
    warnings: [ ...(counts.unknownDates ? ["saved-timestamps-unknown-or-unverified"] : []), "transcript-and-ocr-not-requested", "no-live-saved-completeness-proof" ] };
}

const TagsSchema = z.strictObject({ goal: z.array(z.string().min(1).max(80)).max(10), stage: z.array(z.string().min(1).max(80)).max(10), format: z.array(z.string().min(1).max(80)).max(10), tool: z.array(z.string().min(1).max(80)).max(10), brand: z.array(z.enum(["dneskai", "devshark"])).max(2), effort: z.enum(["small", "medium", "large", "unknown"]) });
const ReferencesSchema = z.strictObject({ projectIds: z.array(z.uuid()).max(20), noteIds: z.array(z.uuid()).max(20), promptIds: z.array(z.uuid()).max(20), toolIds: z.array(z.uuid()).max(20) });
export const KnowledgeEvidenceSchema = z.strictObject({ shortcode: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), channel: z.enum(["caption", "transcript", "ocr", "legacy-note"]), quote: z.string().min(1).max(2000), startSeconds: z.number().nonnegative().nullable(), endSeconds: z.number().nonnegative().nullable() });
export const KnowledgeProcedureSchema = z.strictObject({ title: z.string().min(1).max(300), summary: z.string().min(1).max(2000), steps: z.array(z.string().min(1).max(1500)).min(1).max(12), category: z.enum(["marketing", "development"]), tipGroup: z.enum(TIP_GROUPS).nullable(), tags: TagsSchema, evidence: z.array(KnowledgeEvidenceSchema).min(1).max(30), missingParts: z.array(z.string().max(300)).max(20), contraryClaims: z.array(z.string().max(1000)).max(10) });
export type KnowledgeProcedure = z.infer<typeof KnowledgeProcedureSchema>;
export const KnowledgeItemSchema = KnowledgeProcedureSchema.extend({ aiLinkId: z.uuid().nullable(), procedureHash: z.string().regex(/^[a-f0-9]{64}$/), sourceShortcodes: z.array(z.string()).max(30), references: ReferencesSchema, evidenceStatus: z.enum(["needs-review", "reviewed", "legacy-unverified"]) });
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;
export const emptyReferences = (): z.infer<typeof ReferencesSchema> => ({ projectIds: [], noteIds: [], promptIds: [], toolIds: [] });
export const emptyTags = (): z.infer<typeof TagsSchema> => ({ goal: [], stage: [], format: [], tool: [], brand: [], effort: "unknown" });
export function procedureHash(procedure: Pick<KnowledgeProcedure, "title" | "summary" | "steps" | "category" | "contraryClaims">): string {
  const tidy = (text: string) => text.trim().replace(/\s+/g, " ");
  return contentHash({ title: tidy(procedure.title), summary: tidy(procedure.summary), steps: procedure.steps.map(tidy), category: procedure.category, contraryClaims: procedure.contraryClaims.map(tidy) });
}
export function validateProcedureEvidence(procedure: KnowledgeProcedure, sources: readonly Pick<KnowledgeSource, "shortcode" | "content">[]): string[] {
  const issues: string[] = [];
  for (const evidence of procedure.evidence) {
    const source = sources.find((s) => s.shortcode === evidence.shortcode);
    if (!source || evidence.channel === "legacy-note") { issues.push("unknown-evidence-source"); continue; }
    if (evidence.channel === "caption") {
      if (!source.content.caption?.includes(evidence.quote) || evidence.startSeconds !== null || evidence.endSeconds !== null) issues.push("unsupported-caption-evidence");
    } else {
      const channel = source.content[evidence.channel];
      if (channel.status !== "available" || !channel.segments.some((segment) => segment.text.includes(evidence.quote) && segment.startSeconds === evidence.startSeconds && segment.endSeconds === evidence.endSeconds)) issues.push("unsupported-media-evidence");
    }
  }
  return [...new Set(issues)];
}
export function normalizeExistingTips(tips: readonly AiLink[]): { sources: KnowledgeSource[]; items: KnowledgeItem[]; report: { preserved: number; skipped: number; evidencePending: number } } {
  const items: KnowledgeItem[] = [];
  for (const tip of tips.filter((t) => t.record_type === "idea")) {
    const summary = tipText(tip);
    if (!summary) continue;
    const identity = instagramIdentity(tip.url);
    const procedure: KnowledgeProcedure = { title: tip.title, summary: summary.slice(0, 2000), steps: [summary.slice(0, 1500)], category: "marketing",
      tipGroup: TIP_GROUPS.includes(tip.tip_group as typeof TIP_GROUPS[number]) ? tip.tip_group as typeof TIP_GROUPS[number] : null,
      tags: emptyTags(), evidence: [{ shortcode: identity?.shortcode ?? `legacy-${tip.id}`, channel: "legacy-note", quote: summary.slice(0, 2000), startSeconds: null, endSeconds: null }],
      missingParts: ["Original source/transcript and procedure boundaries need review"], contraryClaims: [] };
    items.push(KnowledgeItemSchema.parse({ ...procedure, aiLinkId: tip.id, procedureHash: procedureHash(procedure), sourceShortcodes: [], references: emptyReferences(), evidenceStatus: "legacy-unverified" }));
  }
  return { sources: [], items, report: { preserved: items.length, skipped: tips.filter((t) => t.record_type === "idea").length - items.length, evidencePending: items.length } };
}
export function filterKnowledge<T extends KnowledgeItem>(items: readonly T[], filter: { search?: string; category?: KnowledgeItem["category"]; brand?: "dneskai" | "devshark"; evidenceStatus?: KnowledgeItem["evidenceStatus"]; projectId?: string }): T[] {
  const words = (filter.search ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => (!filter.category || item.category === filter.category) && (!filter.brand || item.tags.brand.includes(filter.brand)) &&
    (!filter.evidenceStatus || item.evidenceStatus === filter.evidenceStatus) && (!filter.projectId || item.references.projectIds.includes(filter.projectId)) &&
    words.every((word) => [item.title, item.summary, ...item.steps, ...item.tags.goal, ...item.tags.stage, ...item.tags.format, ...item.tags.tool].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(word)));
}
/** Exact hashes merge evidence; semantic similarity only proposes a human review. */
export function duplicateKnowledgeCandidates(item: KnowledgeItem, existing: readonly KnowledgeItem[]): { exact: string[]; possible: string[] } {
  const words = new Set(item.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  return { exact: existing.filter((e) => e.procedureHash === item.procedureHash && e.aiLinkId).map((e) => e.aiLinkId!),
    possible: existing.filter((e) => e.procedureHash !== item.procedureHash && e.aiLinkId && e.title.toLowerCase().split(/\W+/).filter((w) => words.has(w)).length >= 2).map((e) => e.aiLinkId!) };
}
export function composeKnowledgePlaybook(ids: readonly string[], items: readonly KnowledgeItem[]): { knowledgeIds: string[]; text: string; references: ReturnType<typeof emptyReferences> } {
  if (ids.length > 20 || new Set(ids).size !== ids.length) throw new Error("invalid-playbook-selection");
  const selected = ids.map((id) => items.find((item) => item.aiLinkId === id));
  if (selected.some((item) => !item)) throw new Error("knowledge-unavailable");
  const known = selected as KnowledgeItem[];
  return { knowledgeIds: [...ids], text: known.map((item) => `${item.title}\n${item.steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}\nEvidence: ${item.evidenceStatus}${item.missingParts.length ? `\nMissing: ${item.missingParts.join("; ")}` : ""}`).join("\n\n"),
    references: { projectIds: [...new Set(known.flatMap((i) => i.references.projectIds))], noteIds: [...new Set(known.flatMap((i) => i.references.noteIds))], promptIds: [...new Set(known.flatMap((i) => i.references.promptIds))], toolIds: [...new Set(known.flatMap((i) => i.references.toolIds))] } };
}
