import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
    create policy existing_feature_access on storage.objects for all to anon,authenticated using(true) with check(true);`);
  await db.exec(readFileSync("supabase/migrations/20261023130000_dneskai_reel_bucket.sql", "utf8"));
  await db.query("insert into storage.objects(bucket_id,name) values('marketing-reels',$1),('marketing-reels',$2)", [`${owner}/marketing/dneskai/reels/own.mp4`, `${other}/marketing/dneskai/reels/foreign.mp4`]);
}, 30000);
afterAll(async () => { await db?.close(); });
async function asRole<T>(role: "anon" | "authenticated", user: string | null, action: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec("reset role"); }
}

describe("marketing-reels bucket (20261023130000)", () => {
  it("is private, MP4 only and capped at 64 MiB", async () => {
    const bucket = await db.query("select public,file_size_limit::int,allowed_mime_types from storage.buckets where id='marketing-reels'");
    expect(bucket.rows[0]).toEqual({ public: false, file_size_limit: 67108864, allowed_mime_types: ["video/mp4"] });
  });
  it("lets the signed-in owner read only their own prefix and nobody write from the browser", async () => {
    const owned = await asRole("authenticated", owner, () => db.query<{ name: string }>("select name from storage.objects where bucket_id='marketing-reels'"));
    expect(owned.rows.map((row) => row.name)).toEqual([`${owner}/marketing/dneskai/reels/own.mp4`]);
    expect((await asRole("anon", null, () => db.query("select name from storage.objects where bucket_id='marketing-reels'"))).rows).toEqual([]);
    for (const role of ["anon", "authenticated"] as const) {
      await asRole(role, owner, async () => {
        await expect(db.query("insert into storage.objects(bucket_id,name) values('marketing-reels',$1)", [`${owner}/new.mp4`])).rejects.toThrow("row-level security");
        expect((await db.query("delete from storage.objects where bucket_id='marketing-reels' returning id")).rows).toEqual([]);
      });
    }
  });
});
