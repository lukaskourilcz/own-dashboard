import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getAccountTransactions = vi.fn();
vi.mock("@/lib/gocardless", () => ({
  createRequisition: vi.fn(),
  deleteRequisition: vi.fn(),
  getAccountBalances: vi.fn(),
  getAccountDetails: vi.fn(),
  getAccountTransactions: (...args: unknown[]) => getAccountTransactions(...args),
  getEndUserAgreement: vi.fn(),
  getRequisition: vi.fn(),
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

import { gocardlessProvider } from "@/lib/bank/gocardless-adapter";
import type { BankConnection } from "@/lib/types";

const conn = { id: "c1", provider: "gocardless" } as BankConnection;

beforeEach(() => {
  getAccountTransactions.mockReset();
});

describe("gocardlessProvider.fetchTransactions", () => {
  it("reads the whole window whatever the cursor, so a late booking is still found", async () => {
    // Synced on 2026-10-02; the bank books a 2026-10-01 card payment later
    // that day. The next pull must still return it.
    getAccountTransactions.mockResolvedValue({
      transactions: { booked: [{ id: "late", bookingDate: "2026-10-01" }], pending: [] },
    });
    const rows = await gocardlessProvider.fetchTransactions(conn, "acc-1", "2026-10-02");
    expect(getAccountTransactions).toHaveBeenCalledWith("acc-1");
    expect(rows.map((row) => row.external_id)).toEqual(["late"]);
  });

  it("throws when the pull fails, so the sync keeps its cursor", async () => {
    getAccountTransactions.mockRejectedValue(new Error("GET /accounts/acc-1/transactions/ → 429"));
    await expect(
      gocardlessProvider.fetchTransactions(conn, "acc-1", "2026-10-02"),
    ).rejects.toThrow("429");
  });
});
