import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createDneskaiSlideStorage, dneskaiSlideObjectKey, MARKETING_ASSET_URL_SECONDS } from "@/lib/marketing/worker-runtime";
import type { createAdminClient } from "@/lib/supabase/admin";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
const owner = "dbd55242-0c60-483d-8032-edeb348dfd0d";
const renderKey = "b".repeat(64);
const bytes = Buffer.from("test-only-jpeg");
const sha256 = createHash("sha256").update(bytes).digest("hex");

function bucket(state: { public?: boolean; stored?: { bytes: Buffer; metadata: Record<string, string> } | null; uploadError?: boolean } = {}) {
  let stored = state.stored ?? null;
  const files = {
    upload: vi.fn(async (_key: string, body: Buffer, options: { metadata: Record<string, string> }) => {
      if (stored || state.uploadError) return { data: null, error: { message: "already exists" } };
      stored = { bytes: body, metadata: options.metadata };
      return { data: { path: _key }, error: null };
    }),
    info: vi.fn(async () => stored ? { data: { size: stored.bytes.length, contentType: "image/jpeg", metadata: stored.metadata }, error: null } : { data: null, error: { message: "Object not found", status: 404, statusCode: "NoSuchKey" } }),
    download: vi.fn(() => ({asStream: async () => stored ? { data: new Blob([new Uint8Array(stored.bytes)]).stream(), error: null } : { data: null, error: { message: "Object not found", status: 404, statusCode: "NoSuchKey" } }})),
    createSignedUrl: vi.fn(async (key: string) => ({ data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/marketing-assets/${key}?token=test-only` }, error: null })),
  };
  const getBucket = vi.fn(async () => ({ data: { public: state.public ?? false }, error: null }));
  const rpc=vi.fn((_name:string,args:{p_key:string})=>{const query={retry:()=>query,abortSignal:async()=>({data:{ownerId:owner,kind:'slide',key:args.p_key,state:stored?'present':'absent'},error:null})};return query;});
  const db = {rpc, storage: { getBucket, from: vi.fn(() => files) } } as unknown as ReturnType<typeof createAdminClient>;
  return { db, files, getBucket };
}

describe("DNESKAi render cache in the private marketing-assets bucket", () => {
  it("keys one immutable object per owner and render key", () => {
    expect(dneskaiSlideObjectKey(owner, renderKey)).toBe(`${owner}/marketing/dneskai/slides/${renderKey}.jpg`);
    expect(() => dneskaiSlideObjectKey(owner, "not-a-key")).toThrow("asset-input-invalid");
    expect(() => dneskaiSlideObjectKey("not-an-owner", renderKey)).toThrow();
  });
  it("misses on an absent object, then stores once with owner metadata, re-downloads and signs for seven days", async () => {
    const { db, files, getBucket } = bucket();
    const storage = createDneskaiSlideStorage(db, owner);
    expect(await storage.find(renderKey)).toBeNull();
    const stored = await storage.put({ renderKey, bytes, sha256, metadata: { rendererVersion: "test-only" } });
    const key = `${owner}/marketing/dneskai/slides/${renderKey}.jpg`;
    expect(files.upload).toHaveBeenCalledWith(key, bytes, expect.objectContaining({ upsert: false, contentType: "image/jpeg", metadata: { rendererVersion: "test-only", renderKey, sha256, ownerId: owner } }));
    expect(files.createSignedUrl).toHaveBeenLastCalledWith(key, MARKETING_ASSET_URL_SECONDS);
    expect(stored).toEqual({ url: expect.stringMatching(/^https:\/\//), sha256, metadata: { rendererVersion: "test-only", renderKey, sha256, ownerId: owner } });
    const hit = await storage.find(renderKey);
    expect(hit).toEqual({ url: expect.stringMatching(/^https:\/\//), sha256, metadata: { rendererVersion: "test-only", renderKey, sha256, ownerId: owner } });
    expect(files.upload).toHaveBeenCalledTimes(1);
    expect(getBucket).toHaveBeenCalledTimes(1);
  });
  it.each([{ status: 503, statusCode: 'SlowDown' }, { status: 403, statusCode: 'AccessDenied' }, { status: 404, statusCode: 'NoSuchBucket' }, { status: 404, statusCode: 'TenantNotFound' }, { status: 404, statusCode: 'Unexpected' }, null])('refuses an unavailable slide cache instead of declaring a miss (%s)', async (error) => {
    const { db, files } = bucket();
    const storage = createDneskaiSlideStorage(db, owner);
    files.info.mockResolvedValueOnce({ data: null, error } as never);
    await expect(storage.find(renderKey)).rejects.toMatchObject({ code: 'asset-storage-failed' });
    expect(files.upload).not.toHaveBeenCalled();
    expect(files.createSignedUrl).not.toHaveBeenCalled();
  });
  it.each([{ status: 404, statusCode: 'NoSuchKey' }, { status: 404, statusCode: 'not_found' }, { status: 404, statusCode: '404' }, { status: 400, statusCode: '404' }])('confirms owned absence after a typed candidate in the slide cache (%s)', async (error) => {
    const { db, files } = bucket();
    const storage = createDneskaiSlideStorage(db, owner);
    files.info.mockResolvedValueOnce({ data: null, error } as never);
    expect(await storage.find(renderKey)).toBeNull();
    expect(files.createSignedUrl).not.toHaveBeenCalled();
  });
  it("refuses a public bucket, foreign or mismatched metadata and bytes that do not hash to the record", async () => {
    await expect(createDneskaiSlideStorage(bucket({ public: true }).db, owner).find(renderKey)).rejects.toThrow("private-asset-bucket-required");
    for (const metadata of [{ renderKey, sha256, ownerId: "11111111-1111-4111-8111-111111111111" }, { renderKey: "c".repeat(64), sha256, ownerId: owner }, { renderKey, sha256: "not-a-hash", ownerId: owner }]) {
      const { db, files } = bucket({ stored: { bytes, metadata } });
      await expect(createDneskaiSlideStorage(db, owner).find(renderKey)).rejects.toThrow("stored-asset-metadata-mismatch");
      expect(files.createSignedUrl).not.toHaveBeenCalled();
    }
    const tampered = bucket({ stored: { bytes: Buffer.from("other-bytes"), metadata: { renderKey, sha256, ownerId: owner } } });
    await expect(createDneskaiSlideStorage(tampered.db, owner).find(renderKey)).rejects.toThrow("stored-asset-hash-mismatch");
    expect(tampered.files.createSignedUrl).not.toHaveBeenCalled();
  });
  it("never rewrites: a conflicting existing object fails instead of being replaced", async () => {
    const { db, files } = bucket({ stored: { bytes: Buffer.from("test-only-jpeX"), metadata: { renderKey, sha256, ownerId: owner } } });
    await expect(createDneskaiSlideStorage(db, owner).put({ renderKey, bytes, sha256, metadata: {} })).rejects.toThrow("existing-asset-conflict");
    expect(files.createSignedUrl).not.toHaveBeenCalled();
    expect(files.upload).toHaveBeenCalledWith(expect.any(String), bytes, expect.objectContaining({ upsert: false }));
    await expect(createDneskaiSlideStorage(db, owner).put({ renderKey, bytes: Buffer.from("x"), sha256, metadata: {} })).rejects.toThrow("asset-input-invalid");
  });
});

it.each([{}, {public:null}, {public:0}])('refuses unknown private slide bucket metadata: %#',async value=>{const {db,getBucket,files}=bucket();getBucket.mockResolvedValueOnce({data:value,error:null} as never);await expect(createDneskaiSlideStorage(db,owner).find(renderKey)).rejects.toHaveProperty('code','private-asset-bucket-required');expect(files.info).not.toHaveBeenCalled();});
