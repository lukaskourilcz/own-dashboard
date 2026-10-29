import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
import { importBankTransactionBatch } from "@/lib/transaction-import";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let db: PGlite, accountA: string, accountB: string, foreign: string;
const row = (external_id: string, account_id = accountA) => ({ account_id, kind: "expense" as const, amount: 12.34, currency: "CZK", category: null,
  note: "Synthetic bank source", occurred_on: "2026-10-24", external_id, variable_symbol: null, project_id: null, subscription_id: null });
const insert = async (rows: unknown[], user: string | null = owner, bank = true) => (await db.query<{ data: string[] }>(
  `select ${bank ? "import_bank_transaction_batch" : "import_transaction_batch"}($1::jsonb,$2) as data`, [JSON.stringify(rows), user])).rows[0].data;
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-24T01:06:00Z" }); await db.query("insert into auth.users(id) values($1)", [other]);
  [accountA, accountB, foreign] = (await db.query<{ id: string }>("insert into accounts(user_id,name,balance,currency) values($1,'Synthetic A',100,'CZK'),($1,'Synthetic B',200,'CZK'),($2,'Synthetic foreign',300,'CZK') returning id", [owner, other])).rows.map(row => row.id);
  await db.exec(`create function public.test_bank_import() returns trigger language plpgsql as $$ begin
    if new.note='Synthetic suppressed' then return null; end if;
    if new.note='Synthetic altered' then new.amount:=0; end if;
    if new.note='Synthetic failure' then raise exception 'Synthetic bank failure'; end if; return new; end $$;
    create trigger test_bank_import before insert on transactions for each row execute function public.test_bank_import();`);
  await db.exec("set role service_role");
}, 120000);
afterAll(async () => { await db?.close(); });
it("keeps identical provider ids distinct across accounts and replays them safely", async () => {
  const rows = [row("same-provider-id"), row("same-provider-id", accountB)];
  expect(await insert(rows)).toHaveLength(2); expect(await insert(rows)).toEqual([]);
  const saved = (await db.query<{ external_id: string; account_id: string }>("select external_id,account_id from transactions order by account_id")).rows;
  expect(saved.map(row => row.account_id).sort()).toEqual([accountA, accountB].sort()); expect(new Set(saved.map(row => row.external_id)).size).toBe(2);
  for (const stored of saved) expect(stored.external_id).toMatch(new RegExp(`^bank:v2:${stored.account_id}:[0-9a-f]{64}$`));
});
it("recognizes legacy imports only in their source account and preserves owner edits", async () => {
  const legacy = await insert([row("legacy-provider-id")], owner, false);
  await db.query("update transactions set note='Owner retained note',category='Owner category' where id=$1", [legacy[0]]);
  expect(await insert([row("legacy-provider-id")])).toEqual([]);
  expect(await insert([row("legacy-provider-id", accountB)])).toHaveLength(1);
  expect((await db.query("select external_id,note,category from transactions where id=$1", [legacy[0]])).rows).toEqual([{ external_id: "legacy-provider-id", note: "Owner retained note", category: "Owner category" }]);
});
it("deduplicates an older deployed writer after the scoped writer finishes", async () => {
  expect(await insert([row("rolling-deployment-id")])).toHaveLength(1);
  expect(await insert([row("rolling-deployment-id")], owner, false)).toEqual([]);
  expect((await db.query("select count(*)::int as n from transactions where external_id='rolling-deployment-id'")).rows).toEqual([{ n: 0 }]);
});
it.each(["Synthetic suppressed", "Synthetic failure", "Synthetic altered"])("rolls back every intended bank insert on %s", async note => {
  const before = (await db.query<{ n: number }>("select count(*)::int as n from transactions")).rows[0].n;
  await expect(insert([row(`before-${note}`), { ...row(`bad-${note}`), note }])).rejects.toThrow(note === "Synthetic failure" ? "Synthetic bank failure" : note === "Synthetic altered" ? "Import fields not confirmed" : "Import identity not confirmed");
  expect((await db.query("select count(*)::int as n from transactions")).rows).toEqual([{ n: before }]);
});
it("refuses malformed or foreign input even when a legacy id already exists", async () => {
  for (const item of [{ ...row("legacy-provider-id"), amount: -1 }, { ...row("legacy-provider-id"), occurred_on: "2026-02-30" }, { ...row("legacy-provider-id"), external_id: "bank:v2:reserved" }, { ...row("legacy-provider-id"), currency: "USDT" }, { ...row("legacy-provider-id"), extra: true }, { ...row("legacy-provider-id"), account_id: foreign }, { ...row("legacy-provider-id"), account_id: null }]) await expect(insert([item])).rejects.toThrow();
  await expect(insert([row("owner-required")], null)).rejects.toThrow("Owner required");
});
it("refuses account reassignment ambiguity for an existing canonical identity", async () => {
  const [id] = await insert([row("reassigned-id")]); await db.query("update transactions set account_id=$1 where id=$2", [accountB, id]);
  await expect(insert([row("reassigned-id")])).rejects.toThrow("Import identity not confirmed");
});
it("validates confirmed bank receipts through the application port", async () => {
  const client = { rpc: async (name: string, args: { p_rows: unknown[]; p_user_id: string }) => {
    expect(name).toBe("import_bank_transaction_batch"); return { data: await insert(args.p_rows, args.p_user_id), error: null };
  } } as unknown as SupabaseClient;
  expect(await importBankTransactionBatch(client, [row("runtime-port")], owner)).toBe(1);
  expect(await importBankTransactionBatch(client, [row("runtime-port")], owner)).toBe(0);
});
it("recognizes legacy rows beyond the first REST page and refuses conflicting duplicate input", async () => {
  await db.query("insert into transactions(user_id,account_id,kind,amount,currency,occurred_on,external_id) select $1,$2,'expense',1,'CZK','2026-10-24','synthetic-history-'||n from generate_series(1,1201) n", [owner, accountA]);
  expect(await insert([row("synthetic-history-1201")])).toEqual([]);
  await expect(insert([row("conflicting-input"), { ...row("conflicting-input"), amount: 5 }])).rejects.toThrow("Import identity not confirmed");
  expect((await db.query("select count(*)::int as n from transactions where note='Synthetic bank source' and external_id like '%conflicting-input%'")).rows).toEqual([{ n: 0 }]);
});
it("keeps bank writes service-only and all functions invoker-bound", async () => {
  expect((await db.query("select prosecdef,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where proname='import_bank_transaction_batch'")).rows).toEqual([{ prosecdef: false, anon: false, authenticated: false }]);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role;set role ${role}`); await expect(insert([row("forbidden")])).rejects.toThrow("permission denied");
  }
});
