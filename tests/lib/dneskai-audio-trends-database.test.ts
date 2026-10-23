import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`);
  await db.exec(readFileSync("supabase/migrations/20261023130200_dneskai_audio_trends.sql", "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });
async function asRole<T>(role: "anon" | "authenticated" | "service_role", user: string | null, action: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec("reset role"); }
}
const insert = (values: Record<string, unknown>) => {
  const row = { user_id: owner, audio_id: "587784541076604", title: "Song", audio_type: "music", first_seen: "2026-10-22", last_seen: "2026-10-23", ...values };
  const keys = Object.keys(row);
  return db.query(`insert into public.marketing_audio_trends(${keys.join(",")}) values(${keys.map((_, index) => `$${index + 1}`).join(",")})`, Object.values(row));
};

describe("marketing_audio_trends (20261023130200)", () => {
  it("keeps one row per owner and sound and refuses malformed ones", async () => {
    await asRole("service_role", null, () => insert({}));
    await expect(asRole("service_role", null, () => insert({}))).rejects.toThrow(/duplicate key/);
    for (const values of [{ audio_id: "abc" }, { audio_id: "2", audio_type: "podcast" }, { audio_id: "3", cover_artwork_thumbnail_url: "http://x.example/c.jpg" }, { audio_id: "4", first_seen: "2026-10-24" }]) {
      await expect(asRole("service_role", null, () => insert(values))).rejects.toThrow(/check constraint/);
    }
  });
  it("shows each owner only their own sounds and lets no browser write", async () => {
    expect((await asRole("authenticated", owner, () => db.query("select audio_id from public.marketing_audio_trends"))).rows).toHaveLength(1);
    expect((await asRole("authenticated", other, () => db.query("select audio_id from public.marketing_audio_trends"))).rows).toHaveLength(0);
    await expect(asRole("authenticated", owner, () => insert({ audio_id: "9" }))).rejects.toThrow(/permission denied/);
    await expect(asRole("anon", null, () => db.query("select audio_id from public.marketing_audio_trends"))).rejects.toThrow(/permission denied/);
  });
});
