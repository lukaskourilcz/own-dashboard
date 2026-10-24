import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createMigratedDatabase, setDatabaseTime } from "../helpers/supabase-pglite";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
const claim = async (provider = "github", uid = owner) => (await db.query<{ result: { state: string; lease_id: string } }>("select public.claim_oauth_revocation($1,$2) as result", [uid, provider])).rows[0].result;
const complete = async (lease: string, provider = "github", uid = owner) => (await db.query<{ result: boolean }>("select public.complete_oauth_revocation($1,$2,$3) as result", [uid, provider, lease])).rows[0].result;
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: "2026-10-24T00:00:00Z" }); await db.query("insert into auth.users(id) values($1)", [other]); }, 120000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("reset role;delete from public.oauth_refresh_leases;delete from public.github_tokens;delete from public.google_oauth"); await setDatabaseTime(db, "2026-10-24T00:00:00Z");
  await db.query("insert into public.github_tokens(user_id,access_token) values($1,'synthetic-access'),($2,'synthetic-other-access')", [owner, other]);
  await db.query("insert into public.google_oauth(user_id,refresh_token,access_token,expires_at) values($1,'synthetic-refresh','synthetic-access','2026-10-25')", [owner]); await db.exec("set role service_role");
});
it.each(["google", "github"])("reserves even a fresh/nonexpiring %s grant and confirms only its local removal", async provider => {
  const first = await claim(provider); expect(first.state).toBe("claimed"); expect((await claim(provider)).state).toBe("busy");
  expect(await complete(first.lease_id, provider)).toBe(true); expect((await claim(provider)).state).toBe("disconnected");
  expect((await claim("github", other)).state).toBe("claimed");
});
it("cannot clear a newer login or finish after a replaced/expired reservation", async () => {
  const first = await claim(); await db.query("update public.github_tokens set access_token='synthetic-new-login' where user_id=$1", [owner]);
  expect(await complete(first.lease_id)).toBe(false); const newer = await claim(); expect(newer.state).toBe("claimed");
  await setDatabaseTime(db, "2026-10-24T00:01:00Z"); expect(await complete(newer.lease_id)).toBe(false);
  const replacement = await claim(); expect(await complete(newer.lease_id)).toBe(false); expect(await complete(replacement.lease_id)).toBe(true);
});
it("blocks a stale refresh while an explicit removal holds the reservation", async () => {
  await db.query("update public.google_oauth set expires_at='2026-10-23' where user_id=$1", [owner]);
  const first = await claim("google");
  expect((await db.query<{ result: { state: string } }>("select public.claim_oauth_refresh($1,'google') as result", [owner])).rows[0].result.state).toBe("busy");
  expect(await complete(first.lease_id, "google")).toBe(true);
});
it("rolls back suppressed credential deletion without losing its lease", async () => {
  await db.exec("reset role;create function public.test_oauth_delete() returns trigger language plpgsql as $$ begin return null;end $$;create trigger test_oauth_delete before delete on public.github_tokens for each row execute function public.test_oauth_delete();set role service_role");
  try { const first = await claim(); await expect(complete(first.lease_id)).rejects.toThrow("removal unconfirmed"); expect((await claim()).state).toBe("busy"); }
  finally { await db.exec("reset role;drop trigger test_oauth_delete on public.github_tokens;drop function public.test_oauth_delete();set role service_role"); }
});
it("uses invoker functions and denies anonymous/authenticated access", async () => {
  expect((await db.query("select proname,not prosecdef as invoker from pg_proc where proname in ('claim_oauth_revocation','complete_oauth_revocation') order by proname")).rows).toEqual([{ proname: "claim_oauth_revocation", invoker: true }, { proname: "complete_oauth_revocation", invoker: true }]);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role;set role ${role}`); await expect(claim()).rejects.toThrow("permission denied for function"); await expect(complete("33333333-3333-4333-8333-333333333333")).rejects.toThrow("permission denied for function");
  }
});
