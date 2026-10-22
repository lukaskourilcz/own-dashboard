import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ApprovalDecisionSchema, ContentRevisionSchema, PublicationReceiptSchema, SourcePacketSchema, canonicalJson, parseApprovalDecision, parseContentRevision, parsePublicationReceipt, parseSourcePacket, sourceUsable } from "@/lib/marketing/contracts";
import { contentHash, revisionHash } from "@/lib/marketing/hashes";

const content = { title: "Test question", body: "Which value is returned?", category: "javascript", difficulty: "Easy", code: null, options: ["A", "B"], answer: "B", explanation: "Authored explanation", evidence: [], image: null };
const packet = { schemaVersion: "marketing-source/1", brand: "devshark", kind: "question", sourceId: "test-only", sourceRevision: "v1", contentHash: contentHash(content), canonicalUrl: "https://devshark.app/daily/2026-10-18", locale: "en", observedAt: "2026-10-13T08:00:00Z", expiresAt: null, eligible: true, eligibilityReason: "active", content };

describe("marketing source boundary", () => {
  it("rejects schema drift and unwanted private fields", () => {
    expect(() => parseSourcePacket({ ...packet, schemaVersion: "marketing-source/2" })).toThrow();
    expect(() => parseSourcePacket({ ...packet, learnerEmail: "private@example.com" })).toThrow();
  });
  it("rejects brand contamination and invented answer omissions", () => {
    expect(() => parseSourcePacket({ ...packet, brand: "dneskai", locale: "cs" })).toThrow();
    expect(() => parseSourcePacket({ ...packet, content: { ...content, answer: null } })).toThrow();
  });
  it("holds retired and expired sources", () => {
    expect(sourceUsable(parseSourcePacket({ ...packet, eligible: false }))).toBe(false);
    expect(sourceUsable(parseSourcePacket({ ...packet, expiresAt: "2026-10-13T09:00:00Z" }), new Date("2026-10-13T10:00:00Z"))).toBe(false);
  });
  it("hashes reordered object keys identically but preserves answer order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash(["A", "B"])).not.toBe(contentHash(["B", "A"]));
  });
});

// Synthetic protocol QA only; no approval, account or publication is written.
const revisionId = "11111111-1111-4111-8111-111111111111";
const publicationId = "22222222-2222-4222-8222-222222222222";
const revision = parseContentRevision({ schemaVersion: "marketing-content/1", brand: "devshark", title: "Protocol QA only", caption: "Protocol QA caption", format: "post",
  sources: [{ sourceId: packet.sourceId, sourceRevision: packet.sourceRevision, contentHash: packet.contentHash }], knowledgeIds: [],
  assets: [{ url: "https://assets.example.invalid/qa.jpg", sha256: contentHash("QA asset bytes"), mimeType: "image/jpeg", width: 1080, height: 1350, alt: "QA asset" }],
  account: { id: "qa-account", platform: "instagram", handle: "qa-only" }, scheduledAt: "2026-10-14T09:00:00+02:00", timeZone: "Europe/Prague", templateVersion: "qa/1", promptVersion: "qa/1", model: "qa", traceId: null });
const approval = { schemaVersion: "marketing-approval/1", revisionId, revisionHash: revisionHash(revision), decision: "approved", decidedAt: "2026-10-13T10:00:00+02:00", feedback: null };
const receipt = { schemaVersion: "marketing-publication/1", publicationId, revisionId, revisionHash: approval.revisionHash, platform: "instagram", observedAt: "2026-10-14T09:00:00+02:00", status: "published", remoteContainerId: "qa-container", remoteMediaId: "qa-media", remoteUrl: "https://www.instagram.com/p/qa-only/", errorCode: null };

describe("exact owner approval contract", () => {
  it("binds approval to the complete final revision and rejects asset/caption/account/time changes", () => {
    expect(parseApprovalDecision(approval, { revisionId, revisionHash: revisionHash(revision) })).toEqual(approval);
    for (const changed of [
      { ...revision, caption: "Changed caption" },
      { ...revision, assets: [{ ...revision.assets[0], sha256: contentHash("different QA bytes") }] },
      { ...revision, account: { ...revision.account, id: "different-account" } },
      { ...revision, scheduledAt: "2026-10-15T09:00:00+02:00" },
    ]) expect(() => parseApprovalDecision(approval, { revisionId, revisionHash: revisionHash(changed) })).toThrow("approval-revision-mismatch");
    expect(() => parseApprovalDecision(approval, { revisionId: publicationId, revisionHash: approval.revisionHash })).toThrow("approval-revision-mismatch");
  });
  it("rejects bad versions, UUIDs, hashes, timestamps and unknown private fields", () => {
    for (const patch of [{ schemaVersion: "marketing-approval/2" }, { revisionId: "not-a-uuid" }, { revisionHash: "A".repeat(64) }, { revisionHash: "a".repeat(63) }, { decidedAt: "2026-10-13T10:00:00" }, { ownerId: revisionId }, { feedback: "x".repeat(2001) }]) expect(() => parseApprovalDecision({ ...approval, ...patch })).toThrow();
    expect(parseApprovalDecision({ ...approval, decision: "returned", feedback: "QA correction requested" }).decision).toBe("returned");
    expect(parseApprovalDecision({ ...approval, decision: "skipped" }).decision).toBe("skipped");
  });
});

describe("engagement on the revision (#157)", () => {
  const engagement = { keyword: "SKILL", replyMessage: "Tady je návod, jak začít.", publicReply: "Poslali jsme vám to do zpráv." };
  it("accepts a keyword with its DM and optional public reply, and revisions without it", () => {
    expect(parseContentRevision({ ...revision, engagement }).engagement).toEqual(engagement);
    const { publicReply: _omitted, ...withoutReply } = engagement;
    expect(parseContentRevision({ ...revision, engagement: withoutReply }).engagement).toEqual(withoutReply);
    expect(parseContentRevision(revision).engagement).toBeUndefined();
  });
  it("rejects a keyword that is not one upper-case word, empty or long messages and unknown fields", () => {
    for (const patch of [{ keyword: "skill" }, { keyword: "DVĚ SLOVA" }, { keyword: "NÁVOD" }, { keyword: "" }, { keyword: "A".repeat(25) }, { keyword: "AI-TOOL" },
      { replyMessage: "" }, { replyMessage: "x".repeat(1001) }, { publicReply: "" }, { publicReply: "x".repeat(201) }, { url: "https://example.com" }])
      expect(() => parseContentRevision({ ...revision, engagement: { ...engagement, ...patch } })).toThrow();
    expect(parseContentRevision({ ...revision, engagement: { ...engagement, keyword: "A".repeat(24), replyMessage: "x".repeat(1000), publicReply: "x".repeat(200) } }).engagement?.keyword).toHaveLength(24);
  });
  it("keeps engagement to Instagram accounts", () => {
    expect(() => parseContentRevision({ ...revision, format: "thread", assets: [], account: { ...revision.account, platform: "threads" }, engagement })).toThrow();
  });
  it("changes the content hash with the keyword or a message, so the approval no longer matches", () => {
    const withEngagement = parseContentRevision({ ...revision, engagement });
    const approved = { ...approval, revisionHash: revisionHash(withEngagement) };
    expect(revisionHash(withEngagement)).not.toBe(revisionHash(revision));
    for (const changed of [{ ...engagement, keyword: "NAVOD" }, { ...engagement, replyMessage: "Jiný text." }, { keyword: engagement.keyword, replyMessage: engagement.replyMessage }]) {
      const edited = parseContentRevision({ ...revision, engagement: changed });
      expect(revisionHash(edited)).not.toBe(approved.revisionHash);
      expect(() => parseApprovalDecision(approved, { revisionId, revisionHash: revisionHash(edited) })).toThrow("approval-revision-mismatch");
    }
  });
});

describe("durable publication receipt contract", () => {
  it("requires valid published media and a HTTPS public URL bound to the publication/revision/platform", () => {
    expect(parsePublicationReceipt(receipt, { publicationId, revisionId, revisionHash: approval.revisionHash, platform: "instagram" })).toEqual(receipt);
    for (const patch of [{ schemaVersion: "marketing-publication/2" }, { observedAt: "2026-10-14T09:00:00" }, { remoteMediaId: null }, { remoteMediaId: "" }, { remoteMediaId: " " }, { remoteMediaId: "x".repeat(201) }, { remoteUrl: null }, { remoteUrl: "http://www.instagram.com/p/qa" }, { remoteUrl: "https://user:secret@www.instagram.com/p/qa" }, { remoteUrl: `https://www.instagram.com/${"a".repeat(2048)}` }, { errorCode: "uncertain" }, { publicationId: "not-a-uuid" }, { revisionHash: "z".repeat(64) }, { platform: "linkedin" }, { token: "private" }]) expect(() => parsePublicationReceipt({ ...receipt, ...patch })).toThrow();
    for (const expected of [{ publicationId: revisionId, revisionId, revisionHash: approval.revisionHash, platform: "instagram" as const }, { publicationId, revisionId: publicationId, revisionHash: approval.revisionHash, platform: "instagram" as const }, { publicationId, revisionId, revisionHash: contentHash("different revision"), platform: "instagram" as const }, { publicationId, revisionId, revisionHash: approval.revisionHash, platform: "threads" as const }]) expect(() => parsePublicationReceipt(receipt, expected)).toThrow("receipt-publication-mismatch");
  });
  it("keeps queued/cancelled/claimed records unposted and retains ambiguous media only for reconciliation", () => {
    const empty = { ...receipt, remoteContainerId: null, remoteMediaId: null, remoteUrl: null };
    expect(parsePublicationReceipt({ ...empty, status: "queued" }).status).toBe("queued");
    for (const patch of [{ remoteMediaId: "qa-media" }, { remoteContainerId: "qa-container" }, { remoteUrl: receipt.remoteUrl }, { errorCode: "uncertain" }]) expect(() => parsePublicationReceipt({ ...empty, status: "queued", ...patch })).toThrow();
    expect(parsePublicationReceipt({ ...empty, status: "cancelled" }).status).toBe("cancelled");
    expect(parsePublicationReceipt({ ...empty, status: "claimed", remoteContainerId: `intent:${approval.revisionHash}`, errorCode: "container-create-intent" }).status).toBe("claimed");
    for (const status of ["queued", "claimed", "cancelled", "failed"]) expect(() => parsePublicationReceipt({ ...receipt, status, errorCode: status === "failed" ? "remote-failed" : null })).toThrow();
    expect(parsePublicationReceipt({ ...receipt, status: "reconciliation", remoteUrl: null, errorCode: "remote-permalink-unavailable" }).remoteMediaId).toBe("qa-media");
    expect(parsePublicationReceipt({ ...empty, status: "reconciliation", remoteContainerId: "qa-container", errorCode: "meta-request-uncertain" }).remoteMediaId).toBeNull();
    expect(parsePublicationReceipt({ ...empty, status: "failed", errorCode: "source-retired" }).status).toBe("failed");
    expect(() => parsePublicationReceipt({ ...receipt, status: "reconciliation", remoteMediaId: null, errorCode: "uncertain" })).toThrow();
    expect(() => parsePublicationReceipt({ ...empty, status: "reconciliation", errorCode: "x".repeat(101) })).toThrow();
    expect(() => parsePublicationReceipt({ ...empty, status: "claimed", remoteContainerId: "x".repeat(201) })).toThrow();
  });
  it("publishes JSON schemas identical to every shared runtime contract", () => {
    for (const [name, schema] of [["source", SourcePacketSchema], ["content", ContentRevisionSchema], ["approval", ApprovalDecisionSchema], ["publication", PublicationReceiptSchema]] as const) expect(JSON.parse(readFileSync(`contracts/marketing-${name}-v1.schema.json`, "utf8"))).toEqual(z.toJSONSchema(schema));
  });
});
