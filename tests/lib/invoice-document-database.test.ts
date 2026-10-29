import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedDatabase, setDatabaseTime } from "../helpers/supabase-pglite";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const header = { number: "2026001", buyer_name: "Synthetic buyer", issue_date: "2026-10-23",
  due_date: "2026-11-06", currency: "CZK", payment_method: "bank", round_total: true };
const line = { description: "Synthetic work", quantity: 0, unit_price: 120.50, vat_rate: 21, unit: "hod" };
type Document = { invoice: { id: string; updated_at: string; number: string; buyer_name: string; supplier_name: string }; items: { id: string; quantity: number }[] };
let db: PGlite;
let original: Document;
const save = async (creating: boolean, fields: object, items: object[], snapshot?: Document, invoiceId = id) =>
  (await db.query<{ document: Document }>("select save_invoice_document($1,$2,$3::jsonb,$4::jsonb,$5,$6::uuid[]) as document",
    [invoiceId, creating, JSON.stringify(fields), JSON.stringify(items), snapshot?.invoice.updated_at ?? null,
      snapshot?.items.map((item) => item.id) ?? null])).rows[0].document;
const read = async () => (await db.query<{ document: Document }>(`select jsonb_build_object('invoice',to_jsonb(i),'items',
  (select jsonb_agg(to_jsonb(x) order by position,id) from invoice_items x where x.invoice_id=i.id)) as document from invoices i where id=$1`, [id])).rows[0].document;

beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-23T12:00:00Z" });
  await db.query("insert into auth.users(id,email) values($1,'other@example.test')", [other]);
  // Inject a storage failure after the header update/deletion, not just before
  // writes during validation. The entire RPC statement must roll back.
  await db.exec(`create function public.test_invoice_insert_failure() returns trigger language plpgsql as $$ begin
    if new.description='FAIL INSERT' then raise exception 'Synthetic line storage failure'; end if; return new; end $$;
    create trigger test_invoice_insert_failure before insert on public.invoice_items for each row execute function public.test_invoice_insert_failure();`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("set role authenticated");
}, 120000);
afterAll(async () => { await db?.close(); });

it("creates one complete document, preserves zero and safely retries the same identity", async () => {
  original = await save(true, { ...header, status: "issued", supplier_name: "Original supplier" }, [line]);
  expect(original.invoice.id).toBe(id);
  expect(original.items[0].quantity).toBe(0);
  expect(await save(true, { ...header, status: "issued", supplier_name: "Original supplier" }, [line])).toEqual(original);
  await expect(save(true, { ...header, status: "issued", buyer_name: "Changed retry" }, [line])).rejects.toThrow("Invoice changed");
  expect((await db.query<{ count: number }>("select count(*)::int as count from invoices")).rows[0].count).toBe(1);
});
it("rolls back the header and original lines if inserting replacement lines fails", async () => {
  await expect(save(false, { ...header, buyer_name: "Must roll back" }, [{ ...line, description: "FAIL INSERT" }], original)).rejects.toThrow("Synthetic line storage failure");
  expect(await read()).toEqual(original);
  await expect(save(true, { ...header, number: "2026002", status: "draft" }, [{ ...line, description: "FAIL INSERT" }], undefined,
    "44444444-4444-4444-8444-444444444444")).rejects.toThrow("Synthetic line storage failure");
  expect((await db.query<{ count: number }>("select count(*)::int as count from invoices")).rows[0].count).toBe(1);
});
it("rejects partial item collections and stale edits without changing stored data", async () => {
  await expect(save(false, { ...header, buyer_name: "Incomplete" }, [line], { ...original, items: [] })).rejects.toThrow("Invoice changed");
  await setDatabaseTime(db, "2026-10-23T12:01:00Z");
  const updated = await save(false, { ...header, buyer_name: "Confirmed update" }, [{ ...line, quantity: 2 }], original);
  expect(updated.invoice.supplier_name).toBe("Original supplier");
  expect(updated.items[0].quantity).toBe(2);
  // The same edit can be retried using the old version after a lost response.
  expect(await save(false, { ...header, buyer_name: "Confirmed update" }, [{ ...line, quantity: 2 }], original)).toEqual(updated);
  await expect(save(false, { ...header, buyer_name: "Stale edit" }, [line], original)).rejects.toThrow("Invoice changed");
  expect(await read()).toEqual(updated);
});
it("rejects owner/status injection and precision loss, preserving the complete document", async () => {
  const current = await read();
  for (const extra of [{ user_id: other }, { supplier_name: "Rewritten supplier" }, { status: "paid" }]) {
    await expect(save(false, { ...header, ...extra }, [line], current)).rejects.toThrow("Invalid invoice fields");
  }
  for (const changed of [{ quantity: -1 }, { quantity: 0.0001 }, { unit_price: 0.001 }, { vat_rate: -1 }]) {
    await expect(save(false, header, [{ ...line, ...changed }], current)).rejects.toThrow("Invalid invoice amounts");
  }
  expect(await read()).toEqual(current);
});
it("retains parent ownership checks and denies anonymous or service execution", async () => {
  await db.exec("reset role");
  const project = (await db.query<{ id: string }>("insert into projects(user_id,name,slug) values($1,'Foreign synthetic project','foreign-invoice-test') returning id", [other])).rows[0].id;
  await db.exec("set role authenticated");
  const current = await read();
  await expect(save(false, { ...header, project_id: project }, [line], current)).rejects.toThrow("row-level security");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  await expect(save(false, header, [line], current)).rejects.toThrow("Invoice not found");
  expect((await db.query("select prosecdef as definer,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service from pg_proc where proname='save_invoice_document'")).rows).toEqual([{ definer: false, anon: false, service: false }]);
});
