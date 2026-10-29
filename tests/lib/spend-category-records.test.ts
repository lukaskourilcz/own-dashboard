import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
import { SupabaseEmulator } from "../helpers/supabase-emulator";
import { createSpendCategoryRecord, readSpendCategoryRecords, removeSpendCategoryRecord, orderSpendCategories } from "@/lib/spend-category-records";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", instant = "2026-10-25T12:00:00.123456Z";
const fresh = () => ({ ownerId: owner, signal: new AbortController().signal });
const intent = { id, name: "Software", sortOrder: 1 };
const row = { id, user_id: owner, name: "Software", sort_order: 1, created_at: instant };
let db: PGlite;
function client(actor = owner, wrap?: (fetcher: typeof fetch) => typeof fetch) {
  const emulator = new SupabaseEmulator(db, "https://offline.supabase.test", { service: "TEST-ONLY-service", users: { [owner]: "TEST-ONLY-owner", [other]: "TEST-ONLY-other" } }, () => new Date(instant));
  const transport: typeof fetch = (input, init) => emulator.fetch(new Request(input, init));
  const api = createClient("https://offline.supabase.test", "TEST-ONLY-public", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${actor === owner ? "TEST-ONLY-owner" : "TEST-ONLY-other"}` }, fetch: wrap ? wrap(transport) : transport } });
  return { api, emulator };
}
const wire = (value: unknown, count?: number, status = 200) => createClient("https://example.supabase.co", "test-only-anon", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async () => new Response(JSON.stringify(value), { status, headers: count === undefined ? {} : { "content-range": `0-0/${count}` } }) } });
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant }); await db.query("insert into auth.users(id) values($1)", [other]); }, 120_000);
beforeEach(async () => { await db.exec("reset role; delete from spend_categories; delete from transactions; delete from subscriptions"); });
afterEach(() => vi.restoreAllMocks()); afterAll(async () => db?.close());
it("reads one complete owned list and keeps another owner's rows out", async () => {
  await db.query("insert into spend_categories(id,user_id,name,sort_order) values($1,$2,'Software',1),($3,$4,'Private foreign label',2)", [id, owner, otherId, other]);
  const { api, emulator } = client(); expect(await readSpendCategoryRecords(api, fresh())).toMatchObject([{ id, user_id: owner, name: "Software" }]); expect(emulator.requests).toHaveLength(1);
});
it("creates with an exact receipt and resolves an unchanged uncertain retry without duplicates", async () => {
  const { api } = client(); const first = await createSpendCategoryRecord(api, fresh(), intent); expect(first).toMatchObject({ id, user_id: owner, name: "Software", sort_order: 1 }); expect(Date.parse(first.created_at)).toBe(Date.parse(instant));
  expect(await createSpendCategoryRecord(api, fresh(), intent)).toEqual(first); expect((await db.query("select id from spend_categories")).rows).toHaveLength(1);
});
it("resolves case-insensitive and wildcard-containing duplicate names to confirmed canonical spelling", async () => {
  const { api } = client(); await createSpendCategoryRecord(api, fresh(), { ...intent, name: "Cloud_*%" });
  expect(await createSpendCategoryRecord(api, fresh(), { ...intent, id: otherId, name: "cloud_*%" })).toMatchObject({ id, name: "Cloud_*%" });
});
it("foreign sessions cannot create or remove the captured owner's category", async () => {
  const own = client().api, foreign = client(other).api; const saved = await createSpendCategoryRecord(own, fresh(), intent);
  await expect(createSpendCategoryRecord(foreign, fresh(), { ...intent, id: otherId, name: "Another" })).rejects.toThrow("Category unavailable");
  await expect(removeSpendCategoryRecord(foreign, fresh(), saved)).rejects.toThrow("Category unavailable"); expect(await readSpendCategoryRecords(own, fresh())).toEqual([saved]);
});
it("refuses a changed or already removed source and confirms only the exact captured deletion", async () => {
  const { api } = client(); const saved = await createSpendCategoryRecord(api, fresh(), intent);
  await db.query("update spend_categories set sort_order=2 where id=$1", [id]); await expect(removeSpendCategoryRecord(api, fresh(), saved)).rejects.toMatchObject({ reason: "changed" });
  const [current] = await readSpendCategoryRecords(api, fresh()); await removeSpendCategoryRecord(api, fresh(), current); expect(await readSpendCategoryRecords(api, fresh())).toEqual([]);
  await expect(removeSpendCategoryRecord(api, fresh(), current)).rejects.toMatchObject({ reason: "changed" });
});
it("removing a managed choice preserves existing subscription and transaction labels", async () => {
  const { api } = client(); const saved = await createSpendCategoryRecord(api, fresh(), intent);
  await db.query("insert into subscriptions(user_id,name,amount,currency,billing_cycle,next_billing_date,category) values($1,'Synthetic subscription',1,'CZK','monthly','2026-11-01','Software')", [owner]);
  await db.query("insert into transactions(user_id,kind,amount,currency,occurred_on,category) values($1,'expense',1,'CZK','2026-10-25','Software')", [owner]);
  await removeSpendCategoryRecord(api, fresh(), saved); for (const table of ["subscriptions", "transactions"]) expect((await db.query(`select category from ${table}`)).rows).toEqual([{ category: "Software" }]);
});
it("rejects an over-cap collection rather than returning its first thousand as complete", async () => {
  await db.query("insert into spend_categories(id,user_id,name,sort_order) select ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,$1,'Category '||g,g from generate_series(1,1001) g", [owner]);
  await expect(readSpendCategoryRecords(client().api, fresh())).rejects.toThrow("Category unavailable");
});
it.each([
  [[row], undefined], [[row], 2], [[{ ...row, user_id: other }], 1], [[{ ...row, created_at: "bad" }], 1], [[row, { ...row, id: otherId, name: "software" }], 2],
] as const)("refuses missing, capped, foreign or malformed collection evidence (%#)", async (rows, count) => { await expect(readSpendCategoryRecords(wire(rows, count), fresh())).rejects.toThrow("Category unavailable"); });
it.each([{ ...row, id: otherId }, { ...row, user_id: other }, { ...row, name: "Altered" }, { ...row, sort_order: 3 }, null])("refuses an unconfirmed create receipt (%#)", async receipt => {
  await expect(createSpendCategoryRecord(wire(receipt, undefined, 201), fresh(), intent)).rejects.toThrow("Category unavailable");
});
it("cancels before work and bounds a stalled installed-SDK transport without retry", async () => {
  const controller = new AbortController(), fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
  const api = createClient("https://example.supabase.co", "test-only-anon", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher } });
  const pending = readSpendCategoryRecords(api, { ownerId: owner, signal: controller.signal }); const failed = expect(pending).rejects.toThrow("Category unavailable");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); controller.abort(); await failed; expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await expect(createSpendCategoryRecord(api, { ownerId: owner, signal: controller.signal }, intent)).rejects.toThrow("Category unavailable"); expect(fetcher).toHaveBeenCalledOnce();
});
it("retains microsecond ordering and never mutates the source collection", () => {
  const late = { ...row, created_at: "2026-10-25T12:00:00.123457Z" }, early = { ...row, id: otherId }; const values = [late, early];
  expect(orderSpendCategories(values)).toEqual([early, late]); expect(values).toEqual([late, early]);
});
