import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const trackId = "33333333-3333-4333-8333-333333333333";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create schema storage;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb default '{}',unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema auth,storage,public to anon,authenticated,service_role;
    grant execute on function auth.uid(),storage.foldername(text) to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;
    create policy existing_feature_access on storage.objects for all to anon,authenticated using(true) with check(true);`);
  await db.exec(readFileSync("supabase/migrations/20261023130100_dneskai_audio_tracks.sql", "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });
async function asRole<T>(role: "anon" | "authenticated" | "service_role", user: string | null, action: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec("reset role"); }
}
const insert = (values: Record<string, unknown>) => {
  const row = { id: trackId, user_id: owner, title: "Calm Circuit", artist: "Test Artist", source: "pixabay", licence_note: "Pixabay Content License",
    source_url: "https://pixabay.com/music/test-only", storage_path: `marketing-audio/${owner}/${trackId}.mp3`, duration_ms: 60000, mood: ["calm"], ...values };
  const keys = Object.keys(row);
  return db.query(`insert into public.marketing_audio_tracks(${keys.join(",")}) values(${keys.map((_, index) => `$${index + 1}`).join(",")}) returning id`, Object.values(row));
};

describe("marketing_audio_tracks (20261023130100)", () => {
  it("creates the private audio bucket", async () => {
    const bucket = await db.query("select public,file_size_limit::int,allowed_mime_types from storage.buckets where id='marketing-audio'");
    expect(bucket.rows[0]).toMatchObject({ public: false, file_size_limit: 20971520 });
  });

  it("holds a stored track under its owner's path and an Instagram track by its id", async () => {
    await asRole("service_role", null, () => insert({}));
    await asRole("service_role", null, () => insert({ id: "44444444-4444-4444-8444-444444444444", source: "instagram-library", storage_path: null, source_url: null, instagram_audio_id: "123456789" }));
    const rows = await db.query("select count(*)::int as n from public.marketing_audio_tracks");
    expect(rows.rows[0]).toEqual({ n: 2 });
  });

  it.each([
    ["a path outside the owner's folder", { id: "55555555-5555-4555-8555-555555555555", storage_path: `marketing-audio/${other}/55555555-5555-4555-8555-555555555555.mp3` }],
    ["a stored track without its source page", { id: "55555555-5555-4555-8555-555555555555", storage_path: `marketing-audio/${owner}/55555555-5555-4555-8555-555555555555.mp3`, source_url: null }],
    ["an unknown source", { id: "55555555-5555-4555-8555-555555555555", storage_path: `marketing-audio/${owner}/55555555-5555-4555-8555-555555555555.mp3`, source: "spotify" }],
    ["an Instagram track with a file", { id: "55555555-5555-4555-8555-555555555555", source: "instagram-library", instagram_audio_id: "1", storage_path: `marketing-audio/${owner}/55555555-5555-4555-8555-555555555555.mp3` }],
    ["a plain http source page", { id: "55555555-5555-4555-8555-555555555555", storage_path: `marketing-audio/${owner}/55555555-5555-4555-8555-555555555555.mp3`, source_url: "http://pixabay.com/x" }],
    ["six mood tags", { id: "55555555-5555-4555-8555-555555555555", storage_path: `marketing-audio/${owner}/55555555-5555-4555-8555-555555555555.mp3`, mood: ["a", "b", "c", "d", "e", "f"] }],
  ])("refuses %s", async (_name, values) => {
    await expect(asRole("service_role", null, () => insert(values))).rejects.toThrow(/check constraint/);
  });

  it("shows each owner only their own tracks and lets no browser write", async () => {
    expect((await asRole("authenticated", owner, () => db.query("select id from public.marketing_audio_tracks"))).rows).toHaveLength(2);
    expect((await asRole("authenticated", other, () => db.query("select id from public.marketing_audio_tracks"))).rows).toHaveLength(0);
    await expect(asRole("authenticated", owner, () => db.query("update public.marketing_audio_tracks set enabled=false"))).rejects.toThrow(/permission denied/);
    await expect(asRole("authenticated", owner, () => insert({ id: "66666666-6666-4666-8666-666666666666", storage_path: `marketing-audio/${owner}/66666666-6666-4666-8666-666666666666.mp3` }))).rejects.toThrow(/permission denied/);
    await expect(asRole("anon", null, () => db.query("select id from public.marketing_audio_tracks"))).rejects.toThrow(/permission denied/);
  });

  it("keeps audio files to the owner's prefix and out of browser writes", async () => {
    await db.query("insert into storage.objects(bucket_id,name) values('marketing-audio',$1),('marketing-audio',$2)", [`${owner}/${trackId}.mp3`, `${other}/x.mp3`]);
    const owned = await asRole("authenticated", owner, () => db.query<{ name: string }>("select name from storage.objects where bucket_id='marketing-audio'"));
    expect(owned.rows.map((row) => row.name)).toEqual([`${owner}/${trackId}.mp3`]);
    await expect(asRole("authenticated", owner, () => db.query("insert into storage.objects(bucket_id,name) values('marketing-audio',$1)", [`${owner}/new.mp3`]))).rejects.toThrow("row-level security");
  });
});
