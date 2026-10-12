import { describe, expect, it } from "vitest";
import { composeKnowledgePlaybook, duplicateKnowledgeCandidates, emptyReferences, emptyTags, filterKnowledge, instagramIdentity, normalizeExistingTips, planKnowledgeCapture, procedureHash, validateProcedureEvidence, type KnowledgeItem, type KnowledgeProcedure } from "@/lib/marketing/knowledge";
import { extractKnowledge, knowledgeExtractionPrompt, type KnowledgeModel } from "@/lib/marketing/knowledge-extraction";
import { captionOnlyDatasetItem, prepareApifyKnowledgeRun } from "@/lib/marketing/knowledge-providers";
import type { AiLink } from "@/lib/types";
const cutoff = "2026-10-13T00:00:00Z";
const saved = "2026-10-01T12:00:00.000Z";
const url = "https://www.instagram.com/reel/ABC123/?igsh=test";
const capture = (extra = {}) => planKnowledgeCapture({ cutoff, input: [{ url, saved_at: saved, caption: "Choose one goal. Write the first step. Measure each post." }], ...extra }, new Date("2026-10-13T12:00:00Z"));
const procedure = (patch: Partial<KnowledgeProcedure> = {}): KnowledgeProcedure => ({ title: "Choose a goal", summary: "Choose one goal before writing a post.", steps: ["Choose one goal."], category: "marketing", tipGroup: "content", tags: emptyTags(),
 evidence: [{ shortcode: "ABC123", channel: "caption", quote: "Choose one goal.", startSeconds: null, endSeconds: null }], missingParts: [], contraryClaims: [], ...patch });
const item = (patch: Partial<KnowledgeItem> = {}): KnowledgeItem => { const p = procedure(); return { ...p, aiLinkId: "11111111-1111-4111-8111-111111111111", procedureHash: procedureHash(p), sourceShortcodes: ["ABC123"], references: emptyReferences(), evidenceStatus: "needs-review", ...patch }; };
describe("Saved source normalization", () => {
 it("deduplicates shortcode across post/reel tracking variants and rejects credentials/private collection URLs", () => {
  const result = capture({ input: [{ url, saved_at: saved }, { url: "https://instagram.com/p/ABC123/", saved_at: saved }] });
  expect(result.sources).toHaveLength(1); expect(result.counts.duplicates).toBe(1);
  expect(result.sources[0].canonical_url).toBe("https://www.instagram.com/p/ABC123/");
  expect(instagramIdentity("https://user:password@instagram.com/p/ABC123/")).toBeNull();
  expect(instagramIdentity("https://www.instagram.com/user/saved/all-posts/")).toBeNull();
  expect(instagramIdentity("https://instagram.com.evil.example/p/ABC123/")).toBeNull();
 });
 it("stores independent saved/published/imported times and a fixed 21-day cutoff", () => {
  const result = capture({ input: [{ url, saved_at: saved, published_at: "2020-01-01T00:00:00Z" }] });
  expect(result.startsAt).toBe("2026-09-22T00:00:00.000Z"); expect(result.sources[0].saved_at).toBe(saved);
  expect(result.sources[0].published_at).toBe("2020-01-01T00:00:00.000Z"); expect(result.sources[0].imported_at).toBe("2026-10-13T12:00:00.000Z");
 });
 it("keeps missing dates unknown and never filters by publication date", () => {
  expect(capture({ input: [{ url, published_at: saved }] }).sources).toHaveLength(0);
  const unknown = capture({ input: [{ url, published_at: saved }], includeUnknownDates: true });
  expect(unknown.sources[0].saved_at).toBeNull(); expect(unknown.sources[0].saved_at_status).toBe("unknown");
 });
 it("requires a known-item timestamp proof before treating export Saved on as verified", () => {
  const input = { saved_saved_media: [{ string_map_data: { "Saved on": { href: url, timestamp: Date.parse(saved) / 1000 } } }] };
  const unverified = capture({ input, includeUnknownDates: true }); expect(unverified.sources[0].saved_at_status).toBe("unverified");
  const verified = capture({ input, timestampProof: { url, savedAt: saved } }); expect(verified.timestampVerified).toBe(true); expect(verified.sources[0].saved_at_status).toBe("verified");
  expect(() => capture({ input, timestampProof: { url, savedAt: "2026-10-02T12:00:00Z" } })).toThrow("proof-mismatch");
 });
 it("excludes verified out-of-window dates and caps input batches", () => {
  expect(capture({ input: [{ url, saved_at: "2026-09-21T23:59:59Z" }] }).counts.outsideWindow).toBe(1);
  expect(() => capture({ input: Array.from({ length: 501 }, () => ({ url })) })).toThrow("unbounded");
 });
});
describe("Evidence-bounded atomic extraction", () => {
 it("extracts several procedures from one caption without inventing speech; diagnostics remain redacted", async () => {
  const source = capture().sources[0]; const logs: unknown[] = [];
  const model: KnowledgeModel = { model: "claude-test", pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 }, invoke: async () => ({ extraction: { procedures: [procedure(), procedure({ title: "Measure posts", summary: "Measure each post.", steps: ["Measure each post."], evidence: [{ shortcode: "ABC123", channel: "caption", quote: "Measure each post.", startSeconds: null, endSeconds: null }] })], missingParts: [] }, usage: { inputTokens: 100, outputTokens: 100 } }) };
  const extracted = await extractKnowledge(source, { model, consent: true, diagnostics: async (e) => { logs.push(e); } });
  expect(extracted.items).toHaveLength(2); expect(extracted.items.every((i) => i.evidenceStatus === "needs-review")).toBe(true);
  expect(extracted.missingParts).toContain("Actual video transcript unavailable");
  expect(JSON.stringify(logs)).not.toContain(source.content.caption); expect(JSON.stringify(logs)).not.toContain("Choose a goal");
 });
 it("refuses nonexistent transcripts, forged quotes, consent absence and repeat transport attempts", async () => {
  const source = capture().sources[0];
  expect(validateProcedureEvidence(procedure({ evidence: [{ shortcode: "ABC123", channel: "transcript", quote: "Choose one goal.", startSeconds: 0, endSeconds: 4 }] }), [source])).toContain("unsupported-media-evidence");
  expect(validateProcedureEvidence(procedure({ evidence: [{ shortcode: "ABC123", channel: "caption", quote: "Invented advice", startSeconds: null, endSeconds: null }] }), [source])).toContain("unsupported-caption-evidence");
  let calls = 0; const model: KnowledgeModel = { model: "claude-test", pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 }, invoke: async () => { calls++; throw new Error("uncertain transport"); } };
  await expect(extractKnowledge(source, { model, consent: false })).rejects.toThrow("consent"); expect(calls).toBe(0);
  await expect(extractKnowledge(source, { model, consent: true })).rejects.toThrow("provider-failed"); expect(calls).toBe(1);
  expect(knowledgeExtractionPrompt(source).system).toContain("untrusted data");
 });
 it("prepares bounded, cookie-free Apify descriptors and keeps published timestamp separate", () => {
  const plan = prepareApifyKnowledgeRun(capture().sources);
  expect(plan.request.input.resultsLimit).toBe(1); expect(plan.enumeratesPrivateSaved).toBe(false); expect(plan.cookiesRequired).toBe(false);
  expect(plan.request.url).toContain("maxTotalChargeUsd=0.25"); expect(plan.datasetRequest.query.limit).toBe(50);
  expect(captionOnlyDatasetItem({ shortCode: "ABC123", caption: "Caption", timestamp: saved })).toEqual({ shortcode: "ABC123", caption: "Caption", publishedAt: saved, inaccessible: false });
 });
});
describe("Canonical knowledge reuse", () => {
 it("preserves existing tip IDs and leaves source verification explicit", () => {
  const tip: AiLink = { id: "11111111-1111-4111-8111-111111111111", user_id: "owner", category_id: null, title: "Owned tip", url, description: "Authored notes", pricing: null, record_type: "idea", created_at: saved, updated_at: saved };
  const before = structuredClone(tip); const normalized = normalizeExistingTips([tip]);
  expect(normalized.items[0].aiLinkId).toBe(tip.id); expect(normalized.items[0].evidenceStatus).toBe("legacy-unverified"); expect(tip).toEqual(before);
 });
 it("keeps contrary claims separate and proposes semantic duplicates without merging", () => {
  const original = item(); const contrary = item({ aiLinkId: null, contraryClaims: ["This source opposes the first claim"], procedureHash: "b".repeat(64) });
  expect(duplicateKnowledgeCandidates(contrary, [original]).exact).toHaveLength(0);
  expect(procedureHash(procedure({ contraryClaims: ["Opposite claim"] }))).not.toBe(original.procedureHash);
 });
 it("filters by project/evidence and composes stable IDs with canonical references", () => {
  const projectId = "22222222-2222-4222-8222-222222222222"; const owned = item({ references: { ...emptyReferences(), projectIds: [projectId] } });
  expect(filterKnowledge([owned], { projectId, search: "goal", evidenceStatus: "needs-review" })).toHaveLength(1);
  expect(filterKnowledge([owned], { projectId: "other" })).toHaveLength(0);
  const playbook = composeKnowledgePlaybook([owned.aiLinkId!], [owned]); expect(playbook.knowledgeIds).toEqual([owned.aiLinkId]); expect(playbook.references.projectIds).toEqual([projectId]);
  expect(() => composeKnowledgePlaybook(["unowned"], [owned])).toThrow("unavailable");
 });
});
