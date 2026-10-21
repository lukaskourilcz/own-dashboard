import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { refreshMarketingAssetUrls, renewStoredRevisionAssetUrls } from "@/lib/marketing/asset-urls";
import { contentHash, revisionContentHash } from "@/lib/marketing/hashes";
import type { ContentRevision } from "@/lib/marketing/contracts";
const origin = "https://test-only-project.supabase.co";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const revision = "33333333-3333-4333-8333-333333333333";
const template = "a".repeat(64);
// Synthetic immutable bytes test the renewal proof, not image decoder quality.
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const key = `${owner}/marketing/devshark/${revision}/${template}/1-${sha256}.jpg`;
const url = (path = key, token = "old-test-only-token") => `${origin}/storage/v1/object/sign/marketing-assets/${path}?token=${token}`;
const asset = (): ContentRevision["assets"][number] => ({ url: url(), sha256, mimeType: "image/jpeg", width: 1080, height: 1350, alt: "Test-only slide" });
const stored = (): ContentRevision => ({ schemaVersion: "marketing-content/1", brand: "devshark", title: "Test-only post", caption: "Test-only caption", format: "post",
  sources: [{ sourceId: "question:test-only", sourceRevision: "v1", contentHash: template }], knowledgeIds: [], assets: [asset()],
  account: { id: "12345678", platform: "instagram", handle: "test-only" }, scheduledAt: "2099-10-21T06:00:00Z", timeZone: "Europe/Prague",
  templateVersion: "test-only/1", promptVersion: "test-only/1", model: "test-only", traceId: null });
function database() {
  const proof = { ownerId: owner, sha256, revisionId: revision, templateSha256: template, designExportSha256: "b".repeat(64), svgSha256: "c".repeat(64), rendererVersion: "test-only" };
  const info = { name: key, bucketId: "marketing-assets", size: bytes.length, contentType: "image/jpeg", metadata: proof };
  const files = { info: vi.fn(async () => ({ data: info, error: null })), download: vi.fn(async () => ({ data: new Blob([bytes], { type: "image/jpeg" }), error: null })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: url(key, "renewed-test-only-token") }, error: null })), upload: vi.fn(), remove: vi.fn() };
  const storage = { getBucket: vi.fn(async () => ({ data: { public: false }, error: null })), from: vi.fn(() => files) };
  return { db: { storage } as unknown as Parameters<typeof refreshMarketingAssetUrls>[0], storage, files, info, proof };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("owner-only renewal of verified immutable private marketing JPEGs", () => {
  it("renews native signed URLs after verifying stored proof/bytes, preserves assets and keeps the approval identity", async () => {
    const mock = database(); const input = asset(); const before = structuredClone(input); const arbitraryFetch = vi.fn(); vi.stubGlobal("fetch", arbitraryFetch);
    const renewed = await refreshMarketingAssetUrls(mock.db, owner, [input], { supabaseUrl: origin });
    expect(input).toEqual(before); expect(renewed).toEqual([{ ...before, url: url(key, "renewed-test-only-token") }]);
    expect(contentHash({ assets: renewed })).not.toBe(contentHash({ assets: [input] }));
    expect(revisionContentHash({ ...stored(), assets: renewed })).toBe(revisionContentHash(stored()));
    expect(mock.storage.from).toHaveBeenCalledWith("marketing-assets"); expect(mock.files.info).toHaveBeenCalledWith(key);
    expect(mock.files.download).toHaveBeenCalledWith(key, {}, { cache: "no-store" }); expect(mock.files.createSignedUrl).toHaveBeenCalledWith(key, 604800);
    expect(arbitraryFetch).not.toHaveBeenCalled(); expect(mock.files.upload).not.toHaveBeenCalled(); expect(mock.files.remove).not.toHaveBeenCalled();
  });
  it("rejects foreign owner/origin/bucket, URL credentials, traversal, encoded separators and double-decoded keys before any Storage access", async () => {
    const invalid = [url(key.replace(owner, other)), url().replace(origin, "https://evil.example"), url().replace("/sign/", "/public/"), url().replace("marketing-assets/", "other-bucket/"),
      url().replace("https://", "https://user:password@"), url().replace("/marketing/", "/../marketing/"), url().replace("/marketing/", "/%2e%2e/marketing/"),
      url().replace("/marketing/", "%2fmarketing/"), url().replace("/marketing/", "/%252e%252e/marketing/"), `${url()}&download=true`, `${url()}&token=duplicate`, `${url()}#fragment`,
      url().replace("?token=old-test-only-token", ""), url().replace(`1-${sha256}`, `1-${"d".repeat(64)}`)];
    for (const value of invalid) {
      const mock = database(); await expect(refreshMarketingAssetUrls(mock.db, owner, [{ ...asset(), url: value }], { supabaseUrl: origin })).rejects.toThrow("asset-url-untrusted");
      expect(mock.storage.getBucket).not.toHaveBeenCalled(); expect(mock.files.download).not.toHaveBeenCalled();
    }
  });
  it("validates every original URL before a mixed batch can touch another owner's Storage object", async () => {
    const mock = database(); await expect(refreshMarketingAssetUrls(mock.db, owner, [asset(), { ...asset(), url: url(key.replace(owner, other)) }], { supabaseUrl: origin })).rejects.toThrow("asset-url-untrusted");
    expect(mock.storage.getBucket).not.toHaveBeenCalled();
  });
  it("holds public buckets or missing, foreign and path-mismatched proof metadata before downloading/signing", async () => {
    const publicBucket = database(); publicBucket.storage.getBucket.mockResolvedValueOnce({ data: { public: true }, error: null });
    await expect(refreshMarketingAssetUrls(publicBucket.db, owner, [asset()], { supabaseUrl: origin })).rejects.toThrow("private-asset-bucket-required");
    expect(publicBucket.files.download).not.toHaveBeenCalled();
    for (const patch of [{ ownerId: other }, { sha256: "d".repeat(64) }, { revisionId: other }, { templateSha256: "d".repeat(64) }, { designExportSha256: "" }, { rendererVersion: "" }]) {
      const mock = database(); mock.files.info.mockResolvedValueOnce({ data: { ...mock.info, metadata: { ...mock.proof, ...patch } }, error: null });
      await expect(refreshMarketingAssetUrls(mock.db, owner, [asset()], { supabaseUrl: origin })).rejects.toThrow("stored-asset-proof-invalid");
      expect(mock.files.download).not.toHaveBeenCalled(); expect(mock.files.createSignedUrl).not.toHaveBeenCalled();
    }
  });
  it("holds byte, MIME, size and storage identity mismatches and never signs a partially verified batch", async () => {
    for (const patch of [{ name: "another-key" }, { bucketId: "unrelated" }, { size: 8388609 }, { size: 0 }, { contentType: "image/png" }]) {
      const mock = database(); mock.files.info.mockResolvedValueOnce({ data: { ...mock.info, ...patch }, error: null });
      await expect(refreshMarketingAssetUrls(mock.db, owner, [asset()], { supabaseUrl: origin })).rejects.toThrow("stored-asset-proof-invalid");
      expect(mock.files.download).not.toHaveBeenCalled(); expect(mock.files.createSignedUrl).not.toHaveBeenCalled();
    }
    const wrongBytes = database(); wrongBytes.files.download.mockResolvedValueOnce({ data: new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 3, 0xff, 0xd9])], { type: "image/jpeg" }), error: null });
    await expect(refreshMarketingAssetUrls(wrongBytes.db, owner, [asset()], { supabaseUrl: origin })).rejects.toThrow("stored-asset-hash-or-mime-invalid"); expect(wrongBytes.files.createSignedUrl).not.toHaveBeenCalled();
    const wrongMime = database(); wrongMime.files.download.mockResolvedValueOnce({ data: new Blob([bytes], { type: "image/png" }), error: null });
    await expect(refreshMarketingAssetUrls(wrongMime.db, owner, [asset()], { supabaseUrl: origin })).rejects.toThrow("stored-asset-download-invalid");
    const partial = database(); partial.files.info.mockResolvedValueOnce({ data: partial.info, error: null }).mockResolvedValueOnce({ data: { ...partial.info, metadata: { ...partial.proof, ownerId: other } }, error: null });
    await expect(refreshMarketingAssetUrls(partial.db, owner, [asset(), asset()], { supabaseUrl: origin })).rejects.toThrow("stored-asset-proof-invalid"); expect(partial.files.createSignedUrl).not.toHaveBeenCalled();
  });
  it("validates newly signed URLs too and fails closed without exposing native provider exception text", async () => {
    const mock = database(); mock.files.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://evil.example/asset.jpg" }, error: null });
    await expect(refreshMarketingAssetUrls(mock.db, owner, [asset()], { supabaseUrl: origin })).rejects.toThrow("asset-url-untrusted");
    const failure = database(); failure.files.info.mockRejectedValueOnce(new Error("private credential and URL test-only"));
    await expect(refreshMarketingAssetUrls(failure.db, owner, [asset()], { supabaseUrl: origin })).rejects.toThrow("asset-storage-unavailable");
  });
  it("keeps text-only Threads edits free of Storage calls and rejects unsupported media or invalid setup", async () => {
    const mock = database(); expect(await refreshMarketingAssetUrls(mock.db, owner, [])).toEqual([]); expect(mock.storage.getBucket).not.toHaveBeenCalled();
    await expect(refreshMarketingAssetUrls(mock.db, owner, [asset()], { supabaseUrl: "http://localhost" })).rejects.toThrow("asset-storage-origin-required");
    await expect(refreshMarketingAssetUrls(mock.db, owner, [{ ...asset(), mimeType: "video/mp4" }], { supabaseUrl: origin })).rejects.toThrow("asset-mime-unsupported");
    await expect(refreshMarketingAssetUrls(mock.db, "not-an-owner", [asset()], { supabaseUrl: origin })).rejects.toThrow("asset-owner-invalid");
  });
});

describe("renewal of cached DNESKAi studio slides (#117)", () => {
  const renderKey = "e".repeat(64);
  const slideKey = `${owner}/marketing/dneskai/slides/${renderKey}.jpg`;
  function slideDatabase(metadata: Record<string, unknown> = { ownerId: owner, sha256, renderKey }) {
    const info = { name: slideKey, bucketId: "marketing-assets", size: bytes.length, contentType: "image/jpeg", metadata };
    const files = { info: vi.fn(async () => ({ data: info, error: null })), download: vi.fn(async () => ({ data: new Blob([bytes], { type: "image/jpeg" }), error: null })),
      createSignedUrl: vi.fn(async () => ({ data: { signedUrl: url(slideKey, "renewed-test-only-token") }, error: null })), upload: vi.fn(), remove: vi.fn() };
    const storage = { getBucket: vi.fn(async () => ({ data: { public: false }, error: null })), from: vi.fn(() => files) };
    return { db: { storage } as unknown as Parameters<typeof refreshMarketingAssetUrls>[0], files };
  }
  it("renews a render-key slide after re-verifying the bytes against the recorded sha256", async () => {
    const mock = slideDatabase();
    const renewed = await refreshMarketingAssetUrls(mock.db, owner, [{ ...asset(), url: url(slideKey) }], { supabaseUrl: origin });
    expect(renewed[0]?.url).toBe(url(slideKey, "renewed-test-only-token"));
    expect(mock.files.download).toHaveBeenCalledWith(slideKey, {}, { cache: "no-store" });
  });
  it("holds a slide whose recorded render key, owner or sha256 differ and refuses another owner's slide path", async () => {
    for (const metadata of [{ ownerId: owner, sha256, renderKey: "f".repeat(64) }, { ownerId: other, sha256, renderKey }, { ownerId: owner, sha256: "d".repeat(64), renderKey }]) {
      const mock = slideDatabase(metadata);
      await expect(refreshMarketingAssetUrls(mock.db, owner, [{ ...asset(), url: url(slideKey) }], { supabaseUrl: origin })).rejects.toThrow("stored-asset-proof-invalid");
      expect(mock.files.createSignedUrl).not.toHaveBeenCalled();
    }
    const foreign = slideDatabase();
    await expect(refreshMarketingAssetUrls(foreign.db, owner, [{ ...asset(), url: url(slideKey.replace(owner, other)) }], { supabaseUrl: origin })).rejects.toThrow("asset-url-untrusted");
    expect(foreign.files.info).not.toHaveBeenCalled();
  });
});
describe("in-place renewal of a stored revision (#118)", () => {
  function storedDatabase(row: { revision: unknown; content_hash: string; status: string } | null, rpcResult: { data: unknown; error: unknown } = { data: null, error: null }) {
    const mock = database();
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ data: row, error: null })) };
    const rpc = vi.fn(async (_name: string, args: { p_assets: unknown[] }) => rpcResult.data === null && !rpcResult.error ? { data: { contentHash: row?.content_hash, renewed: args.p_assets.length }, error: null } : rpcResult);
    const db = { ...mock.db, from: vi.fn(() => query), rpc } as unknown as Parameters<typeof renewStoredRevisionAssetUrls>[0];
    return { ...mock, db, rpc, query };
  }
  it("re-verifies the bytes, renews through the SQL function and keeps the stored hash", async () => {
    const hash = revisionContentHash(stored());
    const mock = storedDatabase({ revision: stored(), content_hash: hash, status: "approved" });
    expect(await renewStoredRevisionAssetUrls(mock.db, owner, revision, { supabaseUrl: origin })).toEqual({ revisionId: revision, contentHash: hash, renewed: 1 });
    expect(mock.files.download).toHaveBeenCalledWith(key, {}, { cache: "no-store" });
    expect(mock.rpc).toHaveBeenCalledWith("marketing_renew_revision_asset_urls", { p_owner: owner, p_revision: revision, p_expected_hash: hash, p_assets: [{ ...asset(), url: url(key, "renewed-test-only-token") }] });
  });
  it("refuses unusable rows before signing and maps a refused SQL check to one code", async () => {
    const hash = revisionContentHash(stored());
    await expect(renewStoredRevisionAssetUrls(storedDatabase(null).db, owner, revision, { supabaseUrl: origin })).rejects.toThrow("revision-unavailable");
    const superseded = storedDatabase({ revision: stored(), content_hash: hash, status: "superseded" });
    await expect(renewStoredRevisionAssetUrls(superseded.db, owner, revision, { supabaseUrl: origin })).rejects.toThrow("revision-not-renewable");
    const legacyHash = storedDatabase({ revision: stored(), content_hash: contentHash(stored()), status: "review" });
    await expect(renewStoredRevisionAssetUrls(legacyHash.db, owner, revision, { supabaseUrl: origin })).rejects.toThrow("revision-identity-mismatch");
    expect(legacyHash.files.createSignedUrl).not.toHaveBeenCalled();
    const refused = storedDatabase({ revision: stored(), content_hash: hash, status: "review" }, { data: null, error: { message: "renewal changes more than urls" } });
    await expect(renewStoredRevisionAssetUrls(refused.db, owner, revision, { supabaseUrl: origin })).rejects.toThrow("asset-url-renewal-refused");
    const textOnly = storedDatabase({ revision: { ...stored(), assets: [], account: { ...stored().account, platform: "threads" }, format: "thread" }, content_hash: revisionContentHash({ ...stored(), assets: [], account: { ...stored().account, platform: "threads" }, format: "thread" }), status: "review" });
    expect((await renewStoredRevisionAssetUrls(textOnly.db, owner, revision, { supabaseUrl: origin })).renewed).toBe(0);
    expect(textOnly.rpc).not.toHaveBeenCalled();
  });
});
