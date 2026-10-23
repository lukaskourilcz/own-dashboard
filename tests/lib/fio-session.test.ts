import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ reads: 0 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/bank/credentials", () => ({
  readProviderSecret: async () => { state.reads++; return "synthetic-inert-bank-fixture"; },
  hasProviderSecret: async () => true, deleteProviderSecret: async () => {},
}));
import { createFioProvider } from "@/lib/bank/fio-adapter";
import type { BankConnection } from "@/lib/types";
const conn = { id: "connection", user_id: "owner", provider: "fio", sync_cursor: null } as BankConnection;
const response = { accountStatement: { info: { accountId: "1", currency: "CZK", closingBalance: 5 }, transactionList: null } };
beforeEach(() => { state.reads = 0; vi.restoreAllMocks(); });
it("shares one read inside a sync, while a separate request rechecks its credential", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(response));
  const provider = createFioProvider();
  const [consent, accounts, transactions] = await Promise.all([provider.getConsent(conn), provider.listAccounts(conn), provider.fetchTransactions(conn, "fio:1", null)]);
  expect(consent.status).toBe("linked"); expect(accounts).toHaveLength(1); expect(transactions).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(state.reads).toBe(1);
  await createFioProvider().getConsent(conn); expect(fetcher).toHaveBeenCalledTimes(2); expect(state.reads).toBe(2);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
});
it("never reports linked for a malformed payload or mismatched statement account", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => Response.json({})).mockImplementation(async () => Response.json(response));
  expect((await createFioProvider().getConsent(conn)).status).toBe("error");
  await expect(createFioProvider().fetchTransactions(conn, "fio:another", null)).rejects.toThrow("Bank account mismatch");
});
