import { describe, expect, it } from "vitest";
import {
  amountTolerance,
  extractVariableSymbol,
  invoiceSymbol,
  matchPayments,
  normalizeSymbol,
  transactionSymbol,
  type MatchableInvoice,
  type MatchableTransaction,
} from "@/lib/payment-matching";

function invoice(over: Partial<MatchableInvoice> = {}): MatchableInvoice {
  return {
    id: "inv1",
    number: "2026001",
    variable_symbol: "2026001",
    currency: "CZK",
    status: "issued",
    round_total: true,
    ...over,
  };
}

function payment(over: Partial<MatchableTransaction> = {}): MatchableTransaction {
  return {
    id: "tx1",
    kind: "income",
    amount: 38115,
    currency: "CZK",
    note: null,
    occurred_on: "2026-09-10",
    variable_symbol: "2026001",
    invoice_id: null,
    ...over,
  };
}

const totals = (entries: [string, number][]) => new Map(entries);

describe("extractVariableSymbol", () => {
  it("reads the Czech remittance forms a bank actually sends", () => {
    expect(extractVariableSymbol("Platba VS: 2026001")).toBe("2026001");
    expect(extractVariableSymbol("/VS/2026001/SS/0")).toBe("2026001");
    expect(extractVariableSymbol("Úhrada, variabilní symbol 2026001")).toBe("2026001");
    expect(extractVariableSymbol("VS 2026001 od Acme")).toBe("2026001");
  });

  it("returns null when the note carries no symbol", () => {
    expect(extractVariableSymbol("Mzda za srpen")).toBeNull();
    expect(extractVariableSymbol("")).toBeNull();
    expect(extractVariableSymbol(null)).toBeNull();
  });
});

describe("normalizeSymbol", () => {
  it("keeps digits only and caps at the ten SPAYD allows", () => {
    expect(normalizeSymbol(" 2026-001 ")).toBe("2026001");
    expect(normalizeSymbol("123456789012")).toBe("1234567890");
    expect(normalizeSymbol("FV/A")).toBeNull();
  });
});

describe("symbol resolution", () => {
  it("prefers the stored column and falls back to the note", () => {
    expect(transactionSymbol(payment({ variable_symbol: "111", note: "VS: 222" }))).toBe("111");
    expect(transactionSymbol(payment({ variable_symbol: null, note: "VS: 222" }))).toBe("222");
    expect(transactionSymbol(payment({ variable_symbol: null, note: "Mzda" }))).toBeNull();
  });

  it("falls back to the invoice number's digits when no symbol was set", () => {
    expect(invoiceSymbol(invoice({ variable_symbol: null, number: "2026/001" }))).toBe("2026001");
  });
});

describe("amountTolerance", () => {
  it("allows a crown on a rounded CZK invoice and a cent everywhere else", () => {
    expect(amountTolerance(invoice({ round_total: true, currency: "CZK" }))).toBe(1);
    expect(amountTolerance(invoice({ round_total: false, currency: "CZK" }))).toBe(0.01);
    expect(amountTolerance(invoice({ round_total: true, currency: "EUR" }))).toBe(0.01);
  });
});

describe("matchPayments", () => {
  it("pairs an exact payment with its invoice", () => {
    const result = matchPayments({
      invoices: [invoice()],
      totals: totals([["inv1", 38115]]),
      transactions: [payment()],
    });
    expect(result.matched).toEqual([
      { transactionId: "tx1", invoiceId: "inv1", variableSymbol: "2026001", total: 38115 },
    ]);
    expect(result.unmatched).toEqual([]);
    expect(result.scanned).toBe(1);
  });

  it("accepts a sub-crown difference on a rounded CZK invoice", () => {
    const result = matchPayments({
      invoices: [invoice()],
      totals: totals([["inv1", 38115.4]]),
      transactions: [payment({ amount: 38115 })],
    });
    expect(result.matched).toHaveLength(1);
  });

  it("rejects a difference past the tolerance as amount-mismatch", () => {
    const result = matchPayments({
      invoices: [invoice()],
      totals: totals([["inv1", 38115]]),
      transactions: [payment({ amount: 38112 })],
    });
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]).toMatchObject({ reason: "amount-mismatch", invoiceId: "inv1" });
  });

  it("holds a cent-level tolerance on an unrounded invoice", () => {
    const base = invoice({ round_total: false, currency: "EUR" });
    const near = matchPayments({
      invoices: [base],
      totals: totals([["inv1", 1000]]),
      transactions: [payment({ amount: 1000.01, currency: "EUR" })],
    });
    expect(near.matched).toHaveLength(1);

    const off = matchPayments({
      invoices: [base],
      totals: totals([["inv1", 1000]]),
      transactions: [payment({ amount: 1000.5, currency: "EUR" })],
    });
    expect(off.unmatched[0]).toMatchObject({ reason: "amount-mismatch" });
  });

  it("never pairs across currencies, however right the amount looks", () => {
    const result = matchPayments({
      invoices: [invoice()],
      totals: totals([["inv1", 38115]]),
      transactions: [payment({ currency: "EUR" })],
    });
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]).toMatchObject({ reason: "currency-mismatch", invoiceId: "inv1" });
  });

  it("matches the first payment and reports the second as a duplicate", () => {
    const result = matchPayments({
      invoices: [invoice()],
      totals: totals([["inv1", 38115]]),
      transactions: [
        payment({ id: "tx1", occurred_on: "2026-09-10" }),
        payment({ id: "tx2", occurred_on: "2026-09-12" }),
      ],
    });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].transactionId).toBe("tx1");
    expect(result.unmatched).toEqual([
      expect.objectContaining({ reason: "duplicate-payment", invoiceId: "inv1" }),
    ]);
  });

  it("calls a payment for an already-paid invoice a duplicate, not an unknown symbol", () => {
    const result = matchPayments({
      invoices: [invoice({ status: "paid" })],
      totals: totals([["inv1", 38115]]),
      transactions: [payment()],
    });
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]).toMatchObject({
      reason: "duplicate-payment",
      variableSymbol: "2026001",
    });
  });

  it("matches neither invoice when two open ones share a symbol", () => {
    const result = matchPayments({
      invoices: [invoice(), invoice({ id: "inv2", number: "2026002" })],
      totals: totals([
        ["inv1", 38115],
        ["inv2", 38115],
      ]),
      transactions: [payment()],
    });
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]).toMatchObject({ reason: "ambiguous", invoiceId: null });
  });

  it("explains a payment whose symbol belongs to no invoice", () => {
    const result = matchPayments({
      invoices: [invoice()],
      totals: totals([["inv1", 38115]]),
      transactions: [payment({ variable_symbol: "9999" })],
    });
    expect(result.unmatched[0]).toMatchObject({
      reason: "no-open-invoice",
      variableSymbol: "9999",
    });
  });

  it("explains a payment that quotes no symbol at all", () => {
    const result = matchPayments({
      invoices: [invoice()],
      totals: totals([["inv1", 38115]]),
      transactions: [payment({ variable_symbol: null, note: "Mzda za srpen" })],
    });
    expect(result.unmatched[0]).toMatchObject({
      reason: "no-variable-symbol",
      variableSymbol: null,
    });
  });

  it("ignores expenses and payments that are already linked", () => {
    const result = matchPayments({
      invoices: [invoice()],
      totals: totals([["inv1", 38115]]),
      transactions: [
        payment({ id: "tx-expense", kind: "expense" }),
        payment({ id: "tx-linked", invoice_id: "inv-other" }),
      ],
    });
    expect(result.scanned).toBe(0);
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  it("skips an open invoice whose total could not be computed", () => {
    const result = matchPayments({
      invoices: [invoice()],
      totals: totals([]),
      transactions: [payment()],
    });
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]).toMatchObject({ reason: "no-open-invoice" });
  });

  it("reads the symbol out of the note when the column is empty", () => {
    const result = matchPayments({
      invoices: [invoice()],
      totals: totals([["inv1", 38115]]),
      transactions: [payment({ variable_symbol: null, note: "Platba /VS/2026001/SS/0" })],
    });
    expect(result.matched).toHaveLength(1);
  });
});
