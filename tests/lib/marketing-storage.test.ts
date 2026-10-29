import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createMarketingAssetStorage, MARKETING_ASSET_BUCKET } from "@/lib/marketing/worker-runtime";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create schema storage;
    create role anon; create role authenticated; create role service_role bypassrls;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb default '{}',unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid(),storage.foldername(text) to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;
    -- Deliberately broad pre-existing feature policy: the migration must contain it.
    create policy existing_feature_access on storage.objects for all to anon,authenticated using(true) with check(true);
    insert into storage.buckets values('unrelated','unrelated',false,null,null);`);
  await db.exec(readFileSync("supabase/migrations/20261013193107_marketing_private_assets.sql", "utf8"));
  await db.query("insert into storage.objects(bucket_id,name) values('marketing-assets',$1),('marketing-assets',$2),('marketing-assets','unprefixed.jpg'),('unrelated','other-feature.jpg')", [`${owner}/marketing/own.jpg`, `${other}/marketing/foreign.jpg`]);
}, 30000);
afterAll(async () => { await db?.close(); });
async function asRole<T>(role: "anon" | "authenticated" | "service_role", user: string | null, action: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec("reset role"); }
}
describe("private marketing asset bucket", () => {
  it("creates exactly the private JPEG and 8 MiB contract required by the worker", async () => {
    const bucket = await db.query("select id,name,public,file_size_limit::int,allowed_mime_types from storage.buckets where id=$1", [MARKETING_ASSET_BUCKET]);
    expect(bucket.rows[0]).toEqual({ id: "marketing-assets", name: "marketing-assets", public: false, file_size_limit: 8388608, allowed_mime_types: ["image/jpeg"] });
  });
  it("allows only the signed-in owner prefix, even with broader existing read policies", async () => {
    const owned = await asRole("authenticated", owner, () => db.query<{ name: string }>("select name from storage.objects where bucket_id='marketing-assets'"));
    expect(owned.rows.map((row) => row.name)).toEqual([`${owner}/marketing/own.jpg`]);
    expect((await asRole("anon", null, () => db.query("select name from storage.objects where bucket_id='marketing-assets'"))).rows).toEqual([]);
    expect((await asRole("authenticated", null, () => db.query("select name from storage.objects where bucket_id='marketing-assets'"))).rows).toEqual([]);
  });
  it("denies browser uploads, replacement, removal and cross-bucket moves without affecting another feature", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await asRole(role, owner, async () => {
        await expect(db.query("insert into storage.objects(bucket_id,name) values('marketing-assets',$1)", [`${owner}/new.jpg`])).rejects.toThrow("row-level security");
        expect((await db.query("update storage.objects set metadata='{\"changed\":true}' where bucket_id='marketing-assets' returning id")).rows).toEqual([]);
        expect((await db.query("delete from storage.objects where bucket_id='marketing-assets' returning id")).rows).toEqual([]);
        await expect(db.query("update storage.objects set bucket_id='marketing-assets',name=$1 where bucket_id='unrelated'", [`${owner}/moved.jpg`])).rejects.toThrow("row-level security");
      });
    }
    expect((await db.query("select * from storage.objects where bucket_id='marketing-assets'")).rows).toHaveLength(3);
    await asRole("authenticated", owner, async () => {
      await db.query("insert into storage.objects(bucket_id,name) values('unrelated','new-feature.jpg')");
      expect((await db.query("update storage.objects set metadata='{\"changed\":true}' where name='new-feature.jpg' returning id")).rows).toHaveLength(1);
      expect((await db.query("delete from storage.objects where name='new-feature.jpg' returning id")).rows).toHaveLength(1);
    });
  });
  it("allows trusted worker inserts while exact-key duplicates cannot replace prior objects", async () => {
    await asRole("service_role", null, async () => {
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('marketing-assets',$1,$2)", [`${owner}/worker.jpg`, JSON.stringify({ ownerId: owner, sha256: "a".repeat(64) })]);
      await expect(db.query("insert into storage.objects(bucket_id,name) values('marketing-assets',$1)", [`${owner}/worker.jpg`])).rejects.toThrow("duplicate key");
    });
    const row = await db.query<{ metadata: unknown }>("select metadata from storage.objects where name=$1", [`${owner}/worker.jpg`]);
    expect(row.rows[0].metadata).toEqual({ ownerId: owner, sha256: "a".repeat(64) });
  });
  it("runtime prefixes the owner and verifies immutable proof metadata and bytes before signing", async () => {
    const bytes = Buffer.from("synthetic-storage-test-bytes"); const sha256 = createHash("sha256").update(bytes).digest("hex");
    const revisionId = "33333333-3333-4333-8333-333333333333"; const templateSha256 = "a".repeat(64);
    const metadata = { revisionId, templateSha256, designExportSha256: "b".repeat(64), svgSha256: "c".repeat(64), rendererVersion: "test-only" };
    const proof = { ...metadata, sha256, ownerId: owner };
    const files = { upload: vi.fn(async () => ({ error: null })), info: vi.fn(async () => ({ data: { size: bytes.length, contentType: "image/jpeg", metadata: proof }, error: null })),
      download: vi.fn(() => ({ asStream: async () => ({ data: new Blob([bytes]).stream(), error: null }) })), createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://example.test/private-signed" }, error: null })) };
    const facade = { storage: { getBucket: vi.fn(async () => ({ data: { public: false }, error: null })), from: vi.fn(() => files) } };
    const storage = createMarketingAssetStorage(facade as unknown as Parameters<typeof createMarketingAssetStorage>[0], owner, "2026-10-14T12:00:00Z", { now: () => new Date("2026-10-13T12:00:00Z") });
    const key = `marketing/devshark/${revisionId}/${templateSha256}/1-${sha256}.jpg`;
    await storage.put({ key, bytes, sha256, contentType: "image/jpeg", metadata });
    expect(facade.storage.from).toHaveBeenCalledWith("marketing-assets");
    expect(files.upload).toHaveBeenCalledWith(`${owner}/${key}`, bytes, { upsert: false, contentType: "image/jpeg", cacheControl: "3600", metadata: proof });
    expect(files.download).toHaveBeenCalledWith(`${owner}/${key}`, {}, { signal: expect.any(AbortSignal) });
    files.info.mockResolvedValueOnce({ data: { size: bytes.length, contentType: "image/jpeg", metadata: { ...proof, ownerId: other } }, error: null });
    await expect(storage.put({ key, bytes, sha256, contentType: "image/jpeg", metadata })).rejects.toThrow("stored-asset-metadata-mismatch");
    expect(files.createSignedUrl).toHaveBeenCalledTimes(1);
  });
});
