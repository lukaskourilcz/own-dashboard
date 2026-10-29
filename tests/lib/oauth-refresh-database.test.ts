import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createMigratedDatabase, setDatabaseTime } from "../helpers/supabase-pglite";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
type Claim = { state: string; lease_id: string; row?: { user_id: string; access_token: string } };
const claim = async (provider = "google", uid = owner, failed: string | null = null) =>
  (await db.query<{ result: Claim }>("select public.claim_oauth_refresh($1,$2,$3) as result", [uid, provider, failed])).rows[0].result;
const complete = async (lease: string, provider = "google", invalid = false, uid = owner, token = "synthetic-refreshed-token") =>
  (await db.query<{ result: boolean }>("select public.complete_oauth_refresh($1,$2,$3,$4,$5,$6,$7,$8) as result", [uid, provider, lease, token, "synthetic-rotated-refresh", "2026-10-24T02:00:00Z", ["calendar"], invalid])).rows[0].result;
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-24T00:00:00Z" }); await db.query("insert into auth.users(id) values($1)", [other]);
}, 120000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("reset role; delete from public.oauth_refresh_leases; delete from public.google_oauth; delete from public.github_tokens;");
  await setDatabaseTime(db, "2026-10-24T00:00:00Z");
  await db.query("insert into public.google_oauth(user_id,refresh_token,access_token,expires_at) values($1,'synthetic-refresh','synthetic-old-access','2026-10-23')", [owner]);
  await db.query("insert into public.github_tokens(user_id,refresh_token,access_token,expires_at) values($1,'synthetic-refresh','synthetic-old-access','2026-10-23')", [owner]);
  await db.exec("set role service_role");
});
it.each(["google", "github"])("keeps a reservation across transactions and atomically confirms rotated %s credentials", async provider => {
  const first = await claim(provider); expect(first.state).toBe("claimed"); expect(first.row?.user_id).toBe(owner);
  expect(await claim(provider)).toEqual({ state: "busy" }); expect(await complete(first.lease_id, provider)).toBe(true);
  expect((await claim(provider)).row?.access_token).toBe("synthetic-refreshed-token");
  expect((await db.query("select count(*)::int as n from public.oauth_refresh_leases")).rows).toEqual([{ n: 0 }]);
});
it("isolates providers and owners, and refuses stale completion after timeout or replacement", async () => {
  const first = await claim(); expect((await claim("github")).state).toBe("claimed"); expect(await claim("google", other)).toEqual({ state: "disconnected" });
  expect(await complete(first.lease_id, "google", false, other)).toBe(false);
  await setDatabaseTime(db, "2026-10-24T00:01:00Z"); expect(await complete(first.lease_id)).toBe(false);
  const replacement = await claim(); expect(replacement.lease_id).not.toBe(first.lease_id);
  expect(await complete(first.lease_id)).toBe(false); expect(await complete(replacement.lease_id)).toBe(true);
});
it("cannot overwrite or delete a newer login grant, or resurrect a disconnected grant", async () => {
  const first = await claim();
  await db.query("update public.google_oauth set refresh_token='synthetic-new-login-refresh' where user_id=$1", [owner]);
  expect(await complete(first.lease_id)).toBe(false); expect(await complete(first.lease_id, "google", true)).toBe(false);
  const next = await claim(); expect(next.state).toBe("claimed");
  await db.query("delete from public.google_oauth where user_id=$1", [owner]); expect(await complete(next.lease_id)).toBe(false);
});
it("refreshes a rejected current token, but reuses a different confirmed token on the 401 retry", async () => {
  const first = await claim(); await complete(first.lease_id);
  expect((await claim("google", owner, "synthetic-old-access")).state).toBe("cached");
  expect((await claim("google", owner, "synthetic-refreshed-token")).state).toBe("claimed");
  await db.query("update public.github_tokens set refresh_token=null,expires_at=null where user_id=$1", [owner]);
  expect((await claim("github", owner, "synthetic-old-access")).state).toBe("cached");
});
it("removes only the reserved rejected grant and requires a removal receipt", async () => {
  const first = await claim(); expect(await complete(first.lease_id, "google", true)).toBe(true);
  expect(await claim()).toEqual({ state: "disconnected" }); expect((await claim("github")).state).toBe("claimed");
});
it("rolls back altered or suppressed token writes without consuming the reservation", async () => {
  await db.exec("reset role;create function public.test_oauth_write() returns trigger language plpgsql as $$ begin if new.access_token='synthetic-suppress' then return null; end if; if new.access_token='synthetic-alter' then new.refresh_token='synthetic-altered'; end if; return new; end $$; create trigger test_oauth_write before update on public.google_oauth for each row execute function public.test_oauth_write();set role service_role");
  try {
    const first = await claim();
    await expect(complete(first.lease_id, "google", false, owner, "synthetic-suppress")).rejects.toThrow("write unconfirmed");
    await expect(complete(first.lease_id, "google", false, owner, "synthetic-alter")).rejects.toThrow("write unconfirmed");
    expect(await complete(first.lease_id)).toBe(true);
  } finally { await db.exec("reset role;drop trigger test_oauth_write on public.google_oauth;drop function public.test_oauth_write();set role service_role"); }
});
it("rolls back a token update when reservation cleanup is suppressed", async () => {
  await db.exec("reset role;create function public.test_oauth_cleanup() returns trigger language plpgsql as $$ begin return null; end $$;create trigger test_oauth_cleanup before delete on public.oauth_refresh_leases for each row execute function public.test_oauth_cleanup();set role service_role");
  try {
    const first = await claim(); await expect(complete(first.lease_id)).rejects.toThrow("completion unconfirmed");
    expect((await db.query("select access_token from public.google_oauth where user_id=$1", [owner])).rows).toEqual([{ access_token: "synthetic-old-access" }]);
  } finally { await db.exec("reset role;drop trigger test_oauth_cleanup on public.oauth_refresh_leases;drop function public.test_oauth_cleanup();set role service_role"); }
});
it("uses invoker functions with empty search paths and a private RLS table", async () => {
  expect((await db.query("select proname,not prosecdef as invoker,proconfig from pg_proc where proname in ('claim_oauth_refresh','complete_oauth_refresh') order by proname")).rows).toEqual([
    { proname: "claim_oauth_refresh", invoker: true, proconfig: ['search_path=\"\"'] }, { proname: "complete_oauth_refresh", invoker: true, proconfig: ['search_path=\"\"'] },
  ]);
  expect((await db.query("select relrowsecurity as rls from pg_class where oid='public.oauth_refresh_leases'::regclass")).rows).toEqual([{ rls: true }]);
});
it("requires explicit valid requests and denies browser execution or table reads", async () => {
  await expect(claim("unknown")).rejects.toThrow("Invalid OAuth refresh request");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role;set role ${role}`);
    await expect(claim()).rejects.toThrow("permission denied for function");
    await expect(db.query("select * from public.oauth_refresh_leases")).rejects.toThrow("permission denied");
    await expect(complete("33333333-3333-4333-8333-333333333333")).rejects.toThrow("permission denied for function");
  }
});
