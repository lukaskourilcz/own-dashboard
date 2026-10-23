import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import type { BankConnection } from "@/lib/types";

vi.mock("server-only", () => ({}));
const provider = vi.hoisted(() => ({ getConsent: vi.fn(), listAccounts: vi.fn(), fetchTransactions: vi.fn() }));
vi.mock("@/lib/bank/registry", () => ({ getProvider: () => provider }));
import { syncConnection, syncConnectionById } from "@/lib/bank-sync-server";

const owner = "11111111-1111-4111-8111-111111111111", accountId = "33333333-3333-4333-8333-333333333333";
const conn = { id: "22222222-2222-4222-8222-222222222222", user_id: owner, status: "linked", provider: "gocardless", sync_cursor: "2026-10-01" } as BankConnection;
const writes: { table: string; patch: Record<string, unknown> }[] = [];
let accountExists: boolean, failTable: string | null, lookupFails: boolean, failBatch: number, batches: number;
const saved = new Set<string>();
let from: ReturnType<typeof vi.fn>, rpc: ReturnType<typeof vi.fn>;
function client(): SupabaseClient {
  return { from, rpc } as unknown as SupabaseClient;
}
beforeEach(() => {
  writes.length = 0; saved.clear(); accountExists = true; failTable = null; lookupFails = false; failBatch = 0; batches = 0;
  provider.getConsent.mockReset().mockResolvedValue({ status: "linked", expiresAt: null, error: null });
  provider.listAccounts.mockReset().mockResolvedValue([{ accountRef: "synthetic-account", name: "Synthetic account", currency: "CZK", balance: 100 }]);
  provider.fetchTransactions.mockReset().mockResolvedValue(Array.from({ length: 501 }, (_, n) => ({
    kind: "expense", amount: 1, currency: "CZK", category: null, note: "Synthetic row", occurred_on: "2026-10-23",
    external_id: `bank-${n}`, variable_symbol: null,
  })));
  from = vi.fn((table: string) => {
    let patch: Record<string, unknown> = {}, writing = false;
    const filters = new Map<string, unknown>();
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
      update: (value: Record<string, unknown>) => { writing = true; patch = value; return query; },
      insert: (value: Record<string, unknown>) => { writing = true; patch = value; return query; },
      maybeSingle: async () => ({ data: lookupFails ? null : table === "accounts" ? accountExists ? { id: accountId } : null : filters.get("user_id") === owner ? conn : null, error: lookupFails ? {} : null }),
      single: async () => {
        if (!writing || table === failTable) return { data: null, error: {} };
        writes.push({ table, patch }); return { data: { id: table === "accounts" ? accountId : conn.id }, error: null };
      },
    };
    return query;
  });
  rpc = vi.fn(async (name: string, args: { p_user_id: string; p_rows: Record<string, unknown>[] }) => {
    expect(args.p_user_id).toBe(owner);
    if (name === "transaction_rule_context") return { data: { owner_id: owner, rules: [], project_ids: [], subscription_ids: [] }, error: null };
    expect(name).toBe("import_transaction_batch");
    if (++batches === failBatch) return { data: null, error: {} };
    const ids: string[] = [];
    for (const row of args.p_rows) {
      expect(row.account_id).toBe(accountId); expect(row).not.toHaveProperty("user_id"); expect(row).not.toHaveProperty("invoice_id");
      if (saved.has(String(row.external_id))) continue;
      saved.add(String(row.external_id)); ids.push(`44444444-4444-4444-8444-${String(saved.size).padStart(12, "0")}`);
    }
    return { data: ids, error: null };
  });
});

it("retains the cursor after a later batch fails, then safely replays confirmed rows", async () => {
  failBatch = 2;
  await expect(syncConnection(client(), conn)).rejects.toThrow("bank-sync-failed");
  expect(saved.size).toBe(250); expect(writes.some(write => "sync_cursor" in write.patch)).toBe(false);
  failBatch = 0; batches = 0;
  expect(await syncConnection(client(), conn)).toMatchObject({ inserted: 251, accountsLinked: 1, status: "linked" });
  expect(saved.size).toBe(501); expect(writes.filter(write => "sync_cursor" in write.patch)).toHaveLength(1);
  expect(from.mock.calls.some(call => call[0] === "transactions")).toBe(false);
});
it("preserves an existing balance when the provider does not report one", async () => {
  provider.listAccounts.mockResolvedValue([{ accountRef: "synthetic-account", name: "Synthetic account", currency: "CZK", balance: null }]);
  await syncConnection(client(), conn);
  expect(writes.find(write => write.table === "accounts")!.patch).not.toHaveProperty("balance");
});
it("refuses to invent a starting balance for a new account", async () => {
  accountExists = false;
  provider.listAccounts.mockResolvedValue([{ accountRef: "synthetic-account", name: "Synthetic account", currency: "CZK", balance: null }]);
  await expect(syncConnection(client(), conn)).rejects.toThrow("bank-balance-unavailable");
  expect(provider.fetchTransactions).not.toHaveBeenCalled(); expect(writes.some(write => "sync_cursor" in write.patch)).toBe(false);
});
it.each(["accounts", "bank_connections"])("requires confirmed %s writes", async table => {
  failTable = table;
  await expect(syncConnection(client(), conn)).rejects.toThrow("bank-write-unconfirmed");
  expect(writes.some(write => "sync_cursor" in write.patch)).toBe(false);
});
it("does not turn a failed account lookup into account creation", async () => {
  lookupFails = true;
  await expect(syncConnection(client(), conn)).rejects.toThrow("bank-write-unconfirmed");
  expect(writes.some(write => write.table === "accounts")).toBe(false);
  await expect(syncConnectionById(client(), owner, conn.id)).rejects.toThrow("bank-write-unconfirmed");
});
it("stores only fixed error codes and reports transient consent failures honestly", async () => {
  provider.getConsent.mockRejectedValueOnce(new Error("Synthetic private provider detail"));
  await expect(syncConnection(client(), conn)).rejects.toThrow("bank-sync-failed");
  expect(JSON.stringify(writes)).not.toContain("private"); expect(writes[0].patch).toEqual({ last_error: "bank-sync-failed" });
  writes.length = 0;
  provider.getConsent.mockResolvedValue({ status: "error", expiresAt: null, error: "Synthetic private provider detail" });
  expect(await syncConnection(client(), conn)).toMatchObject({ status: "error", inserted: 0 });
  expect(writes[0].patch).toMatchObject({ status: "linked", last_error: "bank-sync-failed" });
  expect(provider.fetchTransactions).not.toHaveBeenCalled();
});
