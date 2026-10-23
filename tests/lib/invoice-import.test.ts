import { expect, it } from "vitest";
import { importedInvoiceLine } from "@/lib/invoice-import";
import { parseCzDate } from "@/lib/invoice-parser";

it("does not add VAT to a gross-only source or guess a mixed rate", () => {
  expect(importedInvoiceLine({ total: 1210, hasVat: true }, true).unitPrice).toBeUndefined();
  expect(importedInvoiceLine({ total: 1330, vatBase: 1200, vatTotal: 130, hasVat: true }, true).unitPrice).toBeUndefined();
  expect(importedInvoiceLine({ total: 1400, vatBase: 1000, vatTotal: 210, hasVat: true }, true).unitPrice).toBeUndefined();
});
it("preserves an evidenced tax base and exact supported tax rate", () => {
  expect(importedInvoiceLine({ total: 1210, vatBase: 1000, vatTotal: 210, hasVat: true }, true))
    .toEqual({ unitPrice: 1000, vatRate: 21, roundTotal: false });
  expect(importedInvoiceLine({ total: 1120, vatBase: 1000, vatTotal: 120, hasVat: true }, true).vatRate).toBe(12);
  expect(importedInvoiceLine({ total: 0, vatBase: 0, vatTotal: 0, hasVat: false }, true).unitPrice).toBe(0);
});
it("retains explicit CZK rounding and non-taxpayer gross amounts", () => {
  expect(importedInvoiceLine({ currency: "CZK", total: 121, vatBase: 100.2, vatTotal: 21.04, hasVat: true }, true))
    .toEqual({ unitPrice: 100.2, vatRate: 21, roundTotal: true });
  expect(importedInvoiceLine({ currency: "EUR", total: 121, vatBase: 100.2, vatTotal: 21.04, hasVat: true }, true).unitPrice).toBeUndefined();
  expect(importedInvoiceLine({ total: 100.2, hasVat: false }, false))
    .toEqual({ unitPrice: 100.2, vatRate: 0, roundTotal: false });
});
it("does not prefill impossible extracted dates", () => {
  expect(parseCzDate("31. 2. 2026")).toBeUndefined();
  expect(parseCzDate("2026-13-01")).toBeUndefined();
  expect(parseCzDate("29. 2. 2024")).toBe("2024-02-29");
});
