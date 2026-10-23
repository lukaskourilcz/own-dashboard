import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";

const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
const store = async (uid: string | null = owner, provider = "fio", value = "synthetic-inert-bank-fixture") =>
  (await db.query<{ id: string }>("select public.store_bank_token($1,$2,$3) as id", [uid, provider, value])).rows[0].id;
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-24T00:00:00Z" }); await db.query("insert into auth.users(id) values($1)", [other]);
  await db.exec(`create function public.test_bank_store_failure() returns trigger language plpgsql as $$ begin
    if new.secret='synthetic-inert-failure-fixture' then raise exception 'Synthetic storage failure'; end if; return new; end $$;
    create trigger test_bank_store_failure before insert or update on public.bank_provider_credentials for each row execute function public.test_bank_store_failure();
    create function public.test_bank_forget_failure() returns trigger language plpgsql as $$ begin
    if old.user_id='${other}' then raise exception 'Synthetic removal failure'; end if; return old; end $$;
    create trigger test_bank_forget_failure before delete on public.bank_provider_credentials for each row execute function public.test_bank_forget_failure();`);
  await db.exec("set role service_role");
}, 120000);
afterAll(async () => { await db?.close(); });
it("requires an explicit service owner and validates supported input without mutation", async () => {
  await expect(store(null)).rejects.toThrow("Invalid bank credential request");
  await expect(store(owner, "gocardless")).rejects.toThrow("Invalid bank credential request");
  await expect(store(owner, "fio", "short")).rejects.toThrow("Invalid bank credential request");
  expect((await db.query("select count(*)::int as n from public.bank_connections")).rows).toEqual([{ n: 0 }]);
});
it("returns one repeatable connection receipt while isolating another owner's token", async () => {
  const first = await store(); expect(await store()).toBe(first); await store(other);
  expect((await db.query("select user_id,count(*)::int as n from public.bank_connections group by user_id order by user_id")).rows).toEqual([{ user_id: owner, n: 1 }, { user_id: other, n: 1 }]);
});
it("rolls back both a new connection and a replacement status when storage fails", async () => {
  const fresh = "33333333-3333-4333-8333-333333333333";
  await db.exec("reset role"); await db.query("insert into auth.users(id) values($1)", [fresh]); await db.exec("set role service_role");
  await expect(store(fresh, "fio", "synthetic-inert-failure-fixture")).rejects.toThrow("Synthetic storage failure");
  expect((await db.query("select count(*)::int as n from public.bank_connections where user_id=$1", [fresh])).rows).toEqual([{ n: 0 }]);
  await db.query("update public.bank_connections set status='linked' where user_id=$1", [owner]);
  await expect(store(owner, "fio", "synthetic-inert-failure-fixture")).rejects.toThrow("Synthetic storage failure");
  expect((await db.query("select status from public.bank_connections where user_id=$1", [owner])).rows).toEqual([{ status: "linked" }]);
  expect((await db.query("select secret='synthetic-inert-bank-fixture' as retained from public.bank_provider_credentials where user_id=$1", [owner])).rows).toEqual([{ retained: true }]);
});
it("refuses ambiguous legacy connections without deleting or replacing them", async () => {
  const extra = (await db.query<{ id: string }>("insert into public.bank_connections(user_id,provider,reference) values($1,'fio','synthetic-extra') returning id", [owner])).rows[0].id;
  await expect(store()).rejects.toThrow("Ambiguous bank connection");
  expect((await db.query("select count(*)::int as n from public.bank_connections where user_id=$1", [owner])).rows).toEqual([{ n: 2 }]);
  await db.query("delete from public.bank_connections where id=$1", [extra]);
});
it("rolls back a failed removal, and confirmed removal preserves imported rows and other providers", async () => {
  await expect(db.query("select public.forget_bank_token($1,'fio')", [other])).rejects.toThrow("Synthetic removal failure");
  expect((await db.query("select count(*)::int as n from public.bank_connections where user_id=$1", [other])).rows).toEqual([{ n: 1 }]);
  await db.query("insert into public.bank_connections(user_id,provider,reference) values($1,'gocardless','synthetic-other-provider')", [owner]);
  await db.query("insert into public.transactions(user_id,kind,amount,currency,occurred_on) values($1,'income',1,'CZK','2026-10-24')", [owner]);
  expect((await db.query("select public.forget_bank_token($1,'fio') as ok", [owner])).rows).toEqual([{ ok: true }]);
  expect((await db.query("select provider from public.bank_connections where user_id=$1", [owner])).rows).toEqual([{ provider: "gocardless" }]);
  expect((await db.query("select count(*)::int as n from public.transactions where user_id=$1", [owner])).rows).toEqual([{ n: 1 }]);
});
it("keeps both RPCs invoker-only and denied to anonymous/authenticated callers", async () => {
  expect((await db.query("select proname,not prosecdef as invoker,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where proname in ('store_bank_token','forget_bank_token') order by proname")).rows).toEqual([
    { proname: "forget_bank_token", invoker: true, anon: false, authenticated: false }, { proname: "store_bank_token", invoker: true, anon: false, authenticated: false },
  ]);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role;set role ${role}`);
    await expect(store()).rejects.toThrow("permission denied for function store_bank_token");
    await expect(db.query("select public.forget_bank_token($1,'fio')", [owner])).rejects.toThrow("permission denied for function forget_bank_token");
  }
});
