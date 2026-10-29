import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedDatabase, setDatabaseTime } from "../helpers/supabase-pglite";
import { setInvoicePaymentState } from "@/lib/invoice-payment-state";
import type { Invoice } from "@/lib/types";

const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let db: PGlite, invoiceId: string, foreignId: string, manualId: string;
type Receipt = { invoice: Invoice; unlinked_transaction_ids: string[] };
const read = async (id = invoiceId) => (await db.query<{ invoice: Invoice }>("select to_jsonb(i) as invoice from public.invoices i where id=$1", [id])).rows[0].invoice;
const change = async (invoice: Invoice, paid = false, paidOn: string | null = null) => (await db.query<{ data: Receipt }>(
  "select public.set_invoice_payment_state($1::uuid,$2::timestamptz,$3::boolean,$4::date) as data", [invoice.id, invoice.updated_at, paid, paidOn])).rows[0].data;
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-24T00:00:00Z" }); await db.query("insert into auth.users(id) values($1)", [other]);
  const invoices = (await db.query<{ id: string }>("insert into invoices(user_id,number,status,paid_on,issue_date,due_date,currency) values($1,'SYNTHETIC-1','paid','2026-10-23','2026-10-01','2026-11-01','CZK'),($2,'SYNTHETIC-FOREIGN','paid','2026-10-23','2026-10-01','2026-11-01','CZK'),($1,'SYNTHETIC-MANUAL','issued',null,'2026-10-01','2026-11-01','CZK') returning id", [owner, other])).rows;
  [invoiceId, foreignId, manualId] = invoices.map(row => row.id);
  await db.query("insert into transactions(user_id,kind,amount,currency,occurred_on,invoice_id,matched_at,match_source) values($1,'income',100,'CZK','2026-10-23',$2,now(),'auto'),($1,'income',50,'CZK','2026-10-23',$2,now(),'manual')", [owner, invoiceId]);
  await db.exec(`create function public.test_invoice_state_failure() returns trigger language plpgsql as $$ begin
    if current_setting('audit.invoice_state_failure',true)='true' then raise exception 'Synthetic invoice state failure'; end if; return new; end $$;
    create trigger test_invoice_state_failure before update on public.invoices for each row execute function public.test_invoice_state_failure();`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec("set role authenticated");
}, 120000);
afterAll(async () => { await db?.close(); });
it("rolls back payment releases when the invoice update fails", async () => {
  const original = await read(); await db.query("select set_config('audit.invoice_state_failure','true',false)");
  await expect(change(original)).rejects.toThrow("Synthetic invoice state failure");
  expect((await db.query("select count(*)::int as n from transactions where invoice_id=$1 and matched_at is not null", [invoiceId])).rows).toEqual([{ n: 2 }]);
  expect((await read()).status).toBe("paid"); await db.query("select set_config('audit.invoice_state_failure','false',false)");
});
it("rejects a stale version before releasing any linked payment", async () => {
  const stale = await read(); await setDatabaseTime(db, "2026-10-24T00:01:00Z");
  await db.query("update invoices set buyer_name='Owner changed buyer',updated_at=now() where id=$1", [invoiceId]);
  await expect(change(stale)).rejects.toThrow("Invoice changed");
  expect((await db.query("select count(*)::int as n from transactions where invoice_id=$1", [invoiceId])).rows).toEqual([{ n: 2 }]);
});
it("reopens and releases every owned payment together, preserving amounts and buyer edits", async () => {
  const original = await read(), result = await change(original);
  expect(result.invoice).toMatchObject({ status: "issued", paid_on: null, buyer_name: "Owner changed buyer" });
  expect(result.unlinked_transaction_ids).toHaveLength(2);
  expect((await db.query("select invoice_id,matched_at,match_source,amount::text from transactions t order by t.amount")).rows).toEqual([
    { invoice_id: null, matched_at: null, match_source: null, amount: "50.00" }, { invoice_id: null, matched_at: null, match_source: null, amount: "100.00" },
  ]);
  expect((await change(original)).unlinked_transaction_ids).toEqual([]);
});
it("confirms a manual paid date through the runtime port and tolerates an identical lost-response retry", async () => {
  const inv = await read(manualId);
  const client = { rpc: async (name: string, args: { p_invoice_id: string; p_expected_updated_at: string; p_paid: boolean; p_paid_on: string | null }) => {
    expect(name).toBe("set_invoice_payment_state");
    return { data: await change({ ...inv, id: args.p_invoice_id, updated_at: args.p_expected_updated_at }, args.p_paid, args.p_paid_on), error: null };
  } } as unknown as SupabaseClient;
  const result = await setInvoicePaymentState(client, { inv, ownerId: owner, paid: true, paidOn: "2026-10-24" });
  expect(result.invoice).toMatchObject({ status: "paid", paid_on: "2026-10-24" }); expect(result.unlinkedIds).toEqual([]);
  await db.query("select set_config('audit.invoice_state_failure','true',false)");
  expect((await change(inv, true, "2026-10-24")).invoice.id).toBe(inv.id);
  await db.query("select set_config('audit.invoice_state_failure','false',false)");
});
it("clears match metadata on invoice deletion without deleting imported transactions", async () => {
  await db.query("update transactions set invoice_id=$1,matched_at=now(),match_source='manual'", [invoiceId]);
  await db.query("delete from invoices where id=$1", [invoiceId]);
  expect((await db.query("select count(*)::int as n from transactions where invoice_id is null and matched_at is null and match_source is null")).rows).toEqual([{ n: 2 }]);
});
it("refuses an over-limit link set without a partial release", async () => {
  await db.query("insert into transactions(user_id,kind,amount,currency,occurred_on,invoice_id,matched_at,match_source) select $1,'income',1,'CZK','2026-10-24',$2,now(),'manual' from generate_series(1,1001)", [owner, manualId]);
  await expect(change(await read(manualId))).rejects.toThrow("Invoice payment link bound exceeded");
  expect((await db.query("select count(*)::int as n from transactions where invoice_id=$1 and matched_at is not null", [manualId])).rows).toEqual([{ n: 1001 }]);
});
it("keeps foreign records invisible and denies anonymous and service execution", async () => {
  await expect(change({ id: foreignId, updated_at: "2026-10-24T00:00:00Z" } as Invoice)).rejects.toThrow("Invoice not found");
  expect((await db.query("select not prosecdef as invoker,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service from pg_proc where proname='set_invoice_payment_state'")).rows).toEqual([{ invoker: true, anon: false, service: false }]);
  for (const role of ["anon", "service_role"]) {
    await db.exec(`reset role;set role ${role}`);
    await expect(change({ id: manualId, updated_at: "2026-10-24T00:00:00Z" } as Invoice)).rejects.toThrow("permission denied for function");
  }
});
