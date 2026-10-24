import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { getAccountTransactions, getRequisition, getAccountBalances, getAccountDetails } = vi.hoisted(() => ({
  getAccountTransactions: vi.fn(), getRequisition: vi.fn(), getAccountBalances: vi.fn(), getAccountDetails: vi.fn(),
}));
vi.mock("@/lib/gocardless", () => ({
  createRequisition: vi.fn(),
  deleteRequisition: vi.fn(),
  getAccountBalances,
  getAccountDetails,
  getAccountTransactions: (...args: unknown[]) => getAccountTransactions(...args),
  getEndUserAgreement: vi.fn(),
  getRequisition,
  isGoCardlessConfigured: () => true,
  listInstitutions: vi.fn(),
  mapTransaction: (tx: { id: string; bookingDate: string }) => ({
    kind: "expense",
    amount: 1,
    currency: "EUR",
    category: null,
    note: null,
    occurred_on: tx.bookingDate,
    external_id: tx.id,
    variable_symbol: null,
  }),
}));

import { createGoCardlessProvider } from "@/lib/bank/gocardless-adapter";
import type { BankConnection } from "@/lib/types";

let gocardlessProvider: ReturnType<typeof createGoCardlessProvider>;
const conn = { id: "c1", user_id: "owner", provider: "gocardless", reference: "synthetic-reference", provider_ref: "requisition", consent_expires_at: null } as BankConnection;

beforeEach(() => {
  gocardlessProvider = createGoCardlessProvider();
  getAccountTransactions.mockReset();
  getRequisition.mockReset().mockResolvedValue({ id: "requisition", reference: conn.reference, accounts: ["account"], status: "LN" });
  getAccountBalances.mockReset().mockRejectedValue(new Error("Synthetic balance outage"));
  getAccountDetails.mockReset().mockRejectedValue(new Error("Synthetic details outage"));
});

describe("gocardlessProvider.fetchTransactions", () => {
  it("reads the whole window whatever the cursor, so a late booking is still found", async () => {
    // Synced on 2026-10-02; the bank books a 2026-10-01 card payment later
    // that day. The next pull must still return it.
    getAccountTransactions.mockResolvedValue({
      transactions: { booked: [{ id: "late", bookingDate: "2026-10-01" }], pending: [] },
    });
    const rows = await gocardlessProvider.fetchTransactions(conn, "acc-1", "2026-10-02");
    expect(getAccountTransactions).toHaveBeenCalledWith("acc-1", undefined, undefined);
    expect(rows.map((row) => row.external_id)).toEqual(["late"]);
  });

  it("throws when the pull fails, so the sync keeps its cursor", async () => {
    getAccountTransactions.mockRejectedValue(new Error("GET /accounts/acc-1/transactions/ → 429"));
    await expect(
      gocardlessProvider.fetchTransactions(conn, "acc-1", "2026-10-02"),
    ).rejects.toThrow("429");
  });
});

it("never invents EUR when both account metadata reads fail", async () => {
  await expect(gocardlessProvider.listAccounts({ ...conn, provider_ref: "requisition" })).rejects.toThrow("bank-account-currency-unavailable");
  getAccountDetails.mockResolvedValue({ account: { name: "Synthetic account", currency: "CZK" } });
  expect(await createGoCardlessProvider().listAccounts({ ...conn, provider_ref: "requisition" })).toEqual([
    { accountRef: "account", name: "Synthetic account", currency: "CZK", balance: null },
  ]);
});

it("refuses missing/duplicate booked movements and does not silently drop an invalid row", async () => {
  getAccountTransactions.mockResolvedValueOnce({}).mockResolvedValueOnce({ transactions: { booked: [{ id: "one", bookingDate: "" }] } })
    .mockResolvedValueOnce({ transactions: { booked: [{ id: "same", bookingDate: "2026-10-24" }, { id: "same", bookingDate: "2026-10-24" }] } });
  for (let n = 0; n < 3; n++) await expect(gocardlessProvider.fetchTransactions(conn, "account", null)).rejects.toThrow();
});

it("shares requisition reads only within the current request and loads account metadata together", async () => {
  let release!: (value: unknown) => void;
  getAccountDetails.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  getAccountBalances.mockResolvedValue({ balances: [{ balanceAmount: { amount: "5", currency: "CZK" } }] });
  expect((await gocardlessProvider.getConsent(conn)).status).toBe("linked");
  const pending = gocardlessProvider.listAccounts(conn);
  await vi.waitFor(() => expect(getAccountBalances).toHaveBeenCalledTimes(1));
  release({ account: { currency: "CZK" } }); expect((await pending)[0].balance).toBe(5);
  expect(getRequisition).toHaveBeenCalledTimes(1);
  await createGoCardlessProvider().getConsent(conn); expect(getRequisition).toHaveBeenCalledTimes(2);
});
it("refuses an upstream requisition whose ownership reference differs", async () => {
  getRequisition.mockResolvedValue({ id: "requisition", reference: "another-reference", accounts: ["account"], status: "LN" });
  await expect(gocardlessProvider.getConsent(conn)).rejects.toThrow("bank-requisition-mismatch");
  expect(getAccountDetails).not.toHaveBeenCalled();
});
