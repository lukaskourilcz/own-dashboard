import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
import { importTransactionBatch } from "@/lib/transaction-import";
import type { SupabaseClient } from "@supabase/supabase-js";

const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let db: PGlite, foreignAccount: string;
const row = (external_id: string) => ({ account_id: null, kind: "expense" as const, amount: 12.34, currency: "CZK", category: null,
  note: "Synthetic import", occurred_on: "2026-10-23", external_id, variable_symbol: null, project_id: null, subscription_id: null });
const insert = async (rows: unknown[], uid: string | null = null) => (await db.query<{ data: string[] }>("select import_transaction_batch($1::jsonb,$2) as data", [JSON.stringify(rows), uid])).rows[0].data;
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-23T22:00:00Z" });
  await db.query("insert into auth.users(id) values($1)", [other]);
  foreignAccount = (await db.query<{ id: string }>("insert into accounts(user_id,name,balance,currency) values($1,'Synthetic foreign',100,'CZK') returning id", [other])).rows[0].id;
  await db.exec(`create function public.test_import_failure() returns trigger language plpgsql as $$ begin if new.external_id='trigger-failure' then raise exception 'Synthetic insert failure'; end if; return new; end $$;
    create trigger test_import_failure before insert on public.transactions for each row execute function public.test_import_failure();`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec("set role authenticated");
}, 120000);
afterAll(async () => { await db?.close(); });

it("reproduces the unqualified partial-index failure, then confirms repeat-safe RPC inserts", async () => {
  await expect(db.query("insert into transactions(user_id,kind,amount,currency,occurred_on,external_id) values($1,'expense',1,'CZK','2026-10-23','synthetic-probe') on conflict(user_id,external_id) do nothing", [owner])).rejects.toMatchObject({ code: "42P10" });
  const inserted = await insert([row("synthetic-import")]); expect(inserted).toHaveLength(1);
  await db.query("update transactions set note='Owner edited' where id=$1", [inserted[0]]);
  expect(await insert([row("synthetic-import")])).toEqual([]);
  expect((await db.query("select note from transactions where id=$1", [inserted[0]])).rows).toEqual([{ note: "Owner edited" }]);
});
it("rolls back the entire batch when a later insert fails", async () => {
  await expect(insert([row("before-failure"), row("trigger-failure")])).rejects.toThrow("Synthetic insert failure");
  expect((await db.query("select count(*)::int as n from transactions where external_id='before-failure'")).rows).toEqual([{ n: 0 }]);
});
it("retains authenticated and service parent/owner boundaries", async () => {
  await expect(insert([row("foreign-owner")], other)).rejects.toThrow("Owner required");
  await expect(insert([{ ...row("foreign-parent"), account_id: foreignAccount }])).rejects.toThrow("Import parent not owned");
  await db.exec("reset role; set role service_role");
  await expect(insert([row("service-missing-owner")])).rejects.toThrow("Owner required");
  await expect(insert([{ ...row("service-foreign-parent"), account_id: foreignAccount }], owner)).rejects.toThrow("Import parent not owned");
  expect(await insert([row("service-owned")], other)).toHaveLength(1);
  await db.exec("reset role; set role authenticated");
  expect((await db.query<{ invoker: boolean; anon: boolean }>("select not prosecdef as invoker,has_function_privilege('anon',oid,'execute') as anon from pg_proc where proname='import_transaction_batch'")).rows).toEqual([{ invoker: true, anon: false }]);
});
it.each([
  { amount: 1.005 }, { amount: -1 }, { amount: "1" }, { currency: "USDT" }, { occurred_on: "2026-02-30" },
  { user_id: other }, { invoice_id: other }, { variable_symbol: "12345678901" }, { note: "x".repeat(501) },
])("refuses invalid precision, fields, dates and ownership injection (%#)", async patch => {
  await expect(insert([{ ...row("invalid-input"), ...patch }])).rejects.toThrow();
});
it("enforces the batch bound and validates real receipts through the runtime port", async () => {
  await expect(insert(Array.from({ length: 251 }, (_, n) => row(`too-many-${n}`)))).rejects.toThrow("Invalid import batch");
  const client = { rpc: async (_name: string, args: { p_rows: unknown[]; p_user_id: string | null }) => ({ data: await insert(args.p_rows, args.p_user_id), error: null }) } as unknown as SupabaseClient;
  expect(await importTransactionBatch(client, [row("port-verified")])).toBe(1);
  expect(await importTransactionBatch(client, [row("port-verified")])).toBe(0);
});
