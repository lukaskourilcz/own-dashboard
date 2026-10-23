import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { readFinancialRecords } from "@/lib/financial-records";

function backend(options: { size: number; cap?: number; failPage?: number; count?: number | null; duplicatePage?: number; missingPage?: number }) {
  const requests: Array<{ table: string; owner?: string; from: number; to: number; counted: boolean; order: string[] }> = [];
  const client = { from(table: string) {
    let owner: string | undefined, counted = false;
    const order: string[] = [];
    const query = {
      select(_columns: string, opts?: { count?: string }) { counted = opts?.count === "exact"; return query; },
      eq(_column: string, value: string) { owner = value; return query; },
      order(column: string) { order.push(column); return query; },
      async range(from: number, to: number) {
        const page = requests.length;
        requests.push({ table, owner, from, to, counted, order });
        if (options.failPage === page) return { data: null, error: new Error("Synthetic late read failure"), count: null };
        const count = options.count === undefined ? options.size : options.count;
        const length = options.missingPage === page ? 0 : Math.max(0, Math.min(to - from + 1, options.cap ?? 500, options.size - from));
        return { data: Array.from({ length }, (_, offset) => ({ id: `row-${options.duplicatePage === page ? offset : from + offset}` })), error: null, count: counted ? count : null };
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, requests };
}

it("reads all 1201 records once, including rows beyond the old cap", async () => {
  const { client, requests } = backend({ size: 1201 });
  const result = await readFinancialRecords(client, "transactions", "owner");
  expect(result.data).toHaveLength(1201);
  expect(new Set(result.data.map(row => row.id)).size).toBe(1201);
  expect(requests.map(request => request.from)).toEqual([0, 500, 1000]);
  expect(requests.every(request => request.owner === "owner" && request.order.join() === "occurred_on,id")).toBe(true);
  expect(requests.filter(request => request.counted)).toHaveLength(1);
});
it("respects a lower provider row cap without assuming a short page is complete", async () => {
  const { client, requests } = backend({ size: 1201, cap: 200 });
  expect((await readFinancialRecords(client, "invoice_items")).data).toHaveLength(1201);
  expect(requests.map(request => request.from)).toEqual([0, 200, 400, 600, 800, 1000, 1200]);
});
it("keeps small and genuinely empty accounts to one request", async () => {
  for (const size of [0, 3, 500]) {
    const { client, requests } = backend({ size });
    expect((await readFinancialRecords(client, "invoices")).data).toHaveLength(size);
    expect(requests).toHaveLength(1);
  }
});
it("does not return partial rows after a late failure, deletion or reordered duplicate", async () => {
  await expect(readFinancialRecords(backend({ size: 1201, failPage: 1 }).client, "transactions")).rejects.toThrow("late read failure");
  await expect(readFinancialRecords(backend({ size: 1201, missingPage: 1 }).client, "transactions")).rejects.toThrow("Incomplete financial snapshot");
  await expect(readFinancialRecords(backend({ size: 1201, duplicatePage: 1 }).client, "transactions")).rejects.toThrow("changed while loading");
  await expect(readFinancialRecords(backend({ size: 3, count: 2 }).client, "invoices")).rejects.toThrow("changed while loading");
});
it("rejects an uncounted or over-bound response before loading more pages", async () => {
  for (const count of [null, 20_001]) {
    const { client, requests } = backend({ size: 500, count });
    await expect(readFinancialRecords(client, "transactions")).rejects.toThrow("count unavailable or exceeds");
    expect(requests).toHaveLength(1);
  }
});
