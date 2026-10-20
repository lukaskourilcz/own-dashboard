import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import { MARKETING_DECK_CONTENT_VERSION, parseSourcePacket, type ContentRevision } from "@/lib/marketing/contracts";
import { contentHash, revisionContentHash } from "@/lib/marketing/hashes";
import { DNESKAI_SLIDES_VERSION } from "@/lib/marketing/dneskai-slides";
import { publicationGate, publishMarketingRevision, type PublishMarketingInput } from "@/lib/marketing/publisher";

// Synthetic DNESKAi single-image post: real JPEG bytes, test-only hosts and token, no network.
const now = new Date("2026-10-21T06:00:00Z");
const owner = "11111111-1111-4111-8111-111111111111";
let bytes: Buffer;
beforeAll(async () => { bytes = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#2f5ae6" } }).jpeg().toBuffer(); });
const content = { title: "Test-only brief", body: "Test-only brief text.", category: "ai-news", difficulty: null, code: null, options: [], answer: null, explanation: null,
  evidence: [{ url: "https://example.com/story", title: "Test-only story", excerpt: "Test-only excerpt.", checkedAt: "2026-10-21T05:50:00Z" }], image: null };
const media = "a".repeat(64);
const assetUrl = (token: string) => `https://assets.example.invalid/storage/v1/object/sign/marketing-assets/${owner}/marketing/dneskai/x/1.jpg?token=${token}`;
function fixture() {
  const source = parseSourcePacket({ schemaVersion: "marketing-source/1", brand: "dneskai", kind: "article", sourceId: "article:test-only", sourceRevision: "v1",
    contentHash: contentHash(content), canonicalUrl: "https://dneskai.vercel.app/articles/test-only", locale: "cs", observedAt: now.toISOString(), expiresAt: null,
    eligible: true, eligibilityReason: "Synthetic test only", content });
  const revision: ContentRevision = { schemaVersion: MARKETING_DECK_CONTENT_VERSION, brand: "dneskai", title: "Test-only post", caption: "Test-only caption.", format: "post",
    sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash }], knowledgeIds: [],
    assets: [{ url: assetUrl("approved-test-only"), sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: "image/jpeg", width: 1080, height: 1350, alt: "Test-only slide" }],
    account: { id: "101", platform: "instagram", handle: "dneskai" }, scheduledAt: now.toISOString(), timeZone: "Europe/Prague",
    templateVersion: "dneskai-photo/1", promptVersion: "marketing-copy/5", model: "test-only", traceId: null,
    deck: { schemaVersion: DNESKAI_SLIDES_VERSION, format: "single-image", slides: [{ type: "single", variant: "photo", headline: "Oznámení", images: [{ slot: "image-1", assetSha256: media, crop: { focal: { x: 0.5, y: 0.5 } } }], alt: "Test-only slide" }] } };
  const hash = revisionContentHash(revision);
  const posts: string[] = [];
  const input: PublishMarketingInput = { now, dryRun: false,
    revisionRow: { id: "22222222-2222-4222-8222-222222222222", user_id: owner, project_id: null, campaign_id: null, revision, content_hash: hash, status: "approved", ready: true,
      approved_at: "2026-10-20T20:00:00Z", approved_hash: hash, feedback: null, created_at: "2026-10-20T19:00:00Z",
      render_report: { schemaVersion: "dneskai-render-report/1", status: "rendered", problems: [], renderKeys: ["k1"], renderedAt: "2026-10-20T19:00:00Z" } },
    publication: { id: "33333333-3333-4333-8333-333333333333", user_id: owner, revision_id: "22222222-2222-4222-8222-222222222222", platform: "instagram",
      status: "claimed", lease_until: "2026-10-21T06:10:00Z", remote_container_id: null, remote_media_id: null, remote_url: null, error_code: null },
    account: { id: "44444444-4444-4444-8444-444444444444", user_id: owner, remote_account_id: "101", brand: "dneskai", platform: "instagram", handle: "dneskai", verified_at: "2026-10-20T08:00:00Z", enabled: true },
    sources: [source],
    config: { enabled: true, apiVersion: "v99.0", apiVersionVerifiedAt: "2026-10-20T08:00:00Z", loginMode: "instagram", accessToken: "synthetic-test-only-token", tokenExpiresAt: "2026-10-30T00:00:00Z",
      scopes: ["instagram_business_basic", "instagram_business_content_publish"], approvedAssetHosts: ["assets.example.invalid"], pollIntervalMs: 0 },
    checkpoint: async () => {}, revalidate: async () => input,
    fetcher: async (request, options) => {
      const url = String(request); const method = options?.method ?? "GET";
      if (url.startsWith("https://assets.example.invalid/")) return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg" } });
      if (url.includes("publishing_limit")) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] });
      if (method === "POST") { posts.push(String(options?.body ?? "")); return Response.json({ id: url.includes("media_publish") ? "301" : "201" }); }
      if (url.includes("/201?")) return Response.json({ id: "201", status_code: "FINISHED" });
      if (url.includes("/301?")) return Response.json({ id: "301", permalink: "https://www.instagram.com/p/test-only" });
      return Response.json({ id: "101", user_id: "101", username: "dneskai" });
    } };
  return { input, posts };
}

describe("publisher gate for media revisions (#118)", () => {
  it("publishes an approved revision after its signed URL was renewed, sending the renewed URL", async () => {
    const { input, posts } = fixture();
    input.revisionRow.revision.assets[0]!.url = assetUrl("renewed-test-only");
    expect(publicationGate(input, input.config, now)).toBeNull();
    expect((await publishMarketingRevision(input)).status).toBe("published");
    expect(posts[0]).toContain(encodeURIComponent("token=renewed-test-only"));
  });
  it("holds a changed crop, swapped image or edited text that carries the old approval", async () => {
    for (const mutate of [
      (revision: ContentRevision) => { revision.deck!.slides[0]!.images[0]!.crop = { focal: { x: 0.5, y: 0.51 } }; },
      (revision: ContentRevision) => { revision.deck!.slides[0]!.images[0]!.assetSha256 = "b".repeat(64); },
      (revision: ContentRevision) => { revision.deck!.slides[0]!.headline = "Jiné oznámení"; },
    ]) {
      const { input, posts } = fixture(); mutate(input.revisionRow.revision);
      expect(publicationGate(input, input.config, now)).toBe("exact-approval-required");
      expect((await publishMarketingRevision(input)).status).toBe("held"); expect(posts).toHaveLength(0);
    }
  });
  it("holds a blocking render report, an unreadable report and bytes that differ from the approved hash", async () => {
    const blocked = fixture();
    blocked.input.revisionRow.render_report = { ...blocked.input.revisionRow.render_report!, status: "refused", problems: [{ slide: 0, code: "image-too-small", blocking: true, message: "test-only" }] };
    expect(publicationGate(blocked.input, blocked.input.config, now)).toBe("render-blocked");
    const unreadable = fixture(); unreadable.input.revisionRow.render_report = { status: "rendered" } as never;
    expect(publicationGate(unreadable.input, unreadable.input.config, now)).toBe("render-blocked");
    const drift = fixture(); const fetcher = drift.input.fetcher!;
    drift.input.fetcher = async (url, options) => String(url).startsWith("https://assets.example.invalid/") ? new Response("different bytes", { headers: { "Content-Type": "image/jpeg" } }) : fetcher(url, options);
    expect((await publishMarketingRevision(drift.input)).errorCode).toBe("asset-hash-mismatch");
    expect(drift.posts).toHaveLength(0);
  });
});
