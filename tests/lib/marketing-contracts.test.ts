import { describe, expect, it } from "vitest";
import { canonicalJson, parseSourcePacket, sourceUsable } from "@/lib/marketing/contracts";
import { contentHash } from "@/lib/marketing/hashes";

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
