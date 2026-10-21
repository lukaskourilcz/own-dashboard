import { describe, expect, it } from "vitest";
import { DneskaiBriefSchema, DNESKAI_BRIEF_VERSION, dneskaiBriefAssetHashes } from "@/lib/marketing/dneskai-brief";

const a = "a".repeat(64);
const b = "b".repeat(64);
const evidence = (candidateId: string, captionOnly = false) => ({
  candidateId,
  sourceId: "instagram:mosseri",
  url: `https://www.instagram.com/p/${candidateId}/`,
  title: "Adam Mosseri o doporučování",
  excerpt: "Caption text",
  publishedAt: "2026-10-19T12:00:00Z",
  dateEstimated: false,
  captionOnly,
});
const media = (assetSha256: string, candidateId: string, position: number) => ({
  assetSha256, candidateId, position, credit: "Foto: @mosseri", width: 1080, height: 1350,
  originKind: "instagram-child" as const, fullBleedCapable: true, insetCapable: true,
});
const base = {
  schemaVersion: DNESKAI_BRIEF_VERSION,
  eventId: "event-1",
  memberHash: "c".repeat(64),
  targetDate: "2026-10-21",
  category: "marketing" as const,
  title: "Instagram mění doporučování",
  evidence: [evidence("c1", true), evidence("c2")],
  media: [media(a, "c1", 0), media(b, "c1", 1)],
  suggestedFormat: "carousel" as const,
  scheduledAt: "2026-10-21T06:00:00Z",
  timeZone: "Europe/Prague" as const,
  observedAt: "2026-10-20T21:30:00Z",
  expiresAt: "2026-10-22T21:30:00Z",
};

describe("DNESKAi brief contract", () => {
  it("accepts a brief whose media belong to its evidence", () => {
    const brief = DneskaiBriefSchema.parse(base);
    expect(dneskaiBriefAssetHashes(brief)).toEqual([a, b]);
  });

  it("rejects media from outside the event, duplicate media and an expired window", () => {
    expect(DneskaiBriefSchema.safeParse({ ...base, media: [media(a, "elsewhere", 0)] }).success).toBe(false);
    expect(DneskaiBriefSchema.safeParse({ ...base, media: [media(a, "c1", 0), media(a, "c2", 0)] }).success).toBe(false);
    expect(DneskaiBriefSchema.safeParse({ ...base, expiresAt: base.observedAt }).success).toBe(false);
  });
});
