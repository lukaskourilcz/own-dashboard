import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ reads: 0, statusFailure: false }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/bank/credentials", () => ({
  readProviderSecret: async () => { state.reads++; return "synthetic-inert-bank-fixture"; },
  hasProviderSecret: async () => { if (state.statusFailure) throw Error("status unavailable"); return true; }, deleteProviderSecret: async () => {},
}));
import { createFioProvider } from "@/lib/bank/fio-adapter";
import type { BankConnection } from "@/lib/types";
const conn = { id: "connection", user_id: "owner", provider: "fio", sync_cursor: null } as BankConnection;
const response = { accountStatement: { info: { accountId: "1", currency: "CZK", closingBalance: 5 }, transactionList: null } };
beforeEach(() => { state.reads = 0; state.statusFailure = false; vi.restoreAllMocks(); });
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

it("aborts the actual statement request when the enclosing processing budget ends", async () => {
  const controller = new AbortController(); let signal!: AbortSignal;
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    signal = init!.signal!; signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const pending = createFioProvider(controller.signal).getConsent(conn);
  await vi.waitFor(() => expect(signal).toBeDefined()); controller.abort();
  expect((await pending).status).toBe("error"); expect(signal.aborted).toBe(true);
});

it("does not turn credential-status failure into confirmed absence", async () => {
  state.statusFailure = true;
  await expect(createFioProvider().isConfigured("owner")).rejects.toThrow("status unavailable");
});
