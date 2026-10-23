import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice, InvoiceItem, Transaction } from "@/lib/types";

type Records = { transactions: Transaction; invoices: Invoice; invoice_items: InvoiceItem };
const limits = { transactions: 20_000, invoices: 10_000, invoice_items: 50_000 } as const;
const ordering = {
  transactions: ["occurred_on", "id"],
  invoices: ["issue_date", "number", "id"],
  invoice_items: ["invoice_id", "position", "id"],
} as const;

/** Financial totals may not use a silently truncated REST response. Pages are
 * ordered deterministically, counted once, and committed to cache only when
 * complete. Small accounts still need one request. Bounds prevent runaway
 * transfers; a failed/inconsistent snapshot leaves verified cached data intact.
 * Every supported table enforces own-only RLS; server reads also pass ownerId.
 */
export async function readFinancialRecords<K extends keyof Records>(
  client: SupabaseClient, table: K, ownerId?: string,
): Promise<{ data: Records[K][]; error: null }> {
  const rows: Records[K][] = [];
  const ids = new Set<string>();
  let expected: number | null = null;
  for (let page = 0; page < 200; page++) {
    let query = client.from(table).select("*", rows.length === 0 ? { count: "exact" } : undefined);
    if (ownerId) query = query.eq("user_id", ownerId);
    for (const column of ordering[table]) query = query.order(column, { ascending: table === "invoice_items" });
    const { data, error, count } = await query.range(rows.length, rows.length + 499);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Financial records unavailable");
    if (expected === null) {
      if (count === null || !Number.isSafeInteger(count) || count < 0 || count > limits[table]) {
        throw new Error("Financial snapshot count unavailable or exceeds the read bound");
      }
      expected = count;
    }
    if (data.length === 0 && rows.length < expected) throw new Error("Incomplete financial snapshot");
    for (const row of data) {
      if (typeof row.id !== "string" || ids.has(row.id)) throw new Error("Financial snapshot changed while loading");
      ids.add(row.id);
      rows.push(row as Records[K]);
    }
    if (rows.length > expected) throw new Error("Financial snapshot changed while loading");
    if (rows.length === expected) return { data: rows, error: null };
  }
  throw new Error("Financial snapshot exceeded the page bound");
}
