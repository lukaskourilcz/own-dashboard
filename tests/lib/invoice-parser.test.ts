import { describe, it, expect } from "vitest";
import {
  parseCzAmount,
  parseCzDate,
  parseInvoiceText,
} from "@/lib/invoice-parser";

describe("parseCzAmount", () => {
  it("parses space-grouped Czech amounts", () => {
    expect(parseCzAmount("65 962,00 Kč")).toBe(65962);
    expect(parseCzAmount("1 200,50")).toBe(1200.5);
  });
  it("parses no-break / narrow spaces", () => {
    expect(parseCzAmount("12 100,00")).toBe(12100);
    expect(parseCzAmount("9 999,99")).toBe(9999.99);
  });
  it("parses dot-thousands comma-decimal", () => {
    expect(parseCzAmount("1.234,56")).toBe(1234.56);
  });
  it("treats a lone dot before 3 digits as thousands", () => {
    expect(parseCzAmount("65.962")).toBe(65962);
  });
  it("keeps a decimal dot", () => {
    expect(parseCzAmount("12.50")).toBe(12.5);
  });
  it("returns undefined when there's no number", () => {
    expect(parseCzAmount("—")).toBeUndefined();
  });
});

describe("parseCzDate", () => {
  it("parses spaced Czech dates", () => {
    expect(parseCzDate("1. 6. 2026")).toBe("2026-06-01");
  });
  it("parses compact Czech dates", () => {
    expect(parseCzDate("26.06.2026")).toBe("2026-06-26");
  });
  it("parses ISO dates", () => {
    expect(parseCzDate("2026-06-15")).toBe("2026-06-15");
  });
  it("returns undefined for junk", () => {
    expect(parseCzDate("není datum")).toBeUndefined();
  });
});

const NON_VAT_INVOICE = `FAKTURA 2026008
Číslo faktury: 2026008
Variabilní symbol: 2026008

Dodavatel:
Jan Novák
Dlouhá 14
110 00 Praha 1
IČO: 12345678

Odběratel:
ACME Solutions s.r.o.
Vinohradská 1200/56
120 00 Praha 2
IČO: 87654321
DIČ: CZ87654321

Datum vystavení: 1. 6. 2026
Datum splatnosti: 15. 6. 2026
Způsob platby: Bankovním převodem
Číslo účtu: 19-2000145399/0800
IBAN: CZ65 0800 0000 1920 0014 5399

Celkem k úhradě: 45 000,00 Kč
Dodavatel není plátcem DPH.`;

describe("parseInvoiceText — non-VAT freelancer invoice", () => {
  const p = parseInvoiceText(NON_VAT_INVOICE);
  it("reads the number and variable symbol", () => {
    expect(p.number).toBe("2026008");
    expect(p.variableSymbol).toBe("2026008");
  });
  it("reads the dates", () => {
    expect(p.issueDate).toBe("2026-06-01");
    expect(p.dueDate).toBe("2026-06-15");
  });
  it("reads the total and currency", () => {
    expect(p.total).toBe(45000);
    expect(p.currency).toBe("CZK");
    expect(p.hasVat).toBe(false);
  });
  it("reads the bank account and IBAN", () => {
    expect(p.bankAccount).toBe("19-2000145399/0800");
    expect(p.iban).toBe("CZ6508000000192000145399");
  });
  it("reads the buyer (Odběratel), not the supplier", () => {
    expect(p.buyer?.name).toBe("ACME Solutions s.r.o.");
    expect(p.buyer?.ico).toBe("87654321");
    expect(p.buyer?.dic).toBe("CZ87654321");
  });
});

const VAT_INVOICE = `Faktura - daňový doklad
Číslo dokladu: FV-2026-014

Dodavatel
Studio Novák s.r.o.
IČO 11122233
DIČ CZ11122233

Odběratel
Klient a.s.
IČO 99988877
DIČ CZ99988877

Datum vystavení 12.06.2026
DUZP 12.06.2026
Datum splatnosti 26.06.2026
Variabilní symbol 20260014

Základ daně 10 000,00
DPH 21 % 2 100,00
Celkem k úhradě 12 100,00 Kč`;

describe("parseInvoiceText — VAT invoice", () => {
  const p = parseInvoiceText(VAT_INVOICE);
  it("keeps an alphanumeric invoice number", () => {
    expect(p.number).toBe("FV-2026-014");
  });
  it("reads issue / due / taxable-supply dates", () => {
    expect(p.issueDate).toBe("2026-06-12");
    expect(p.dueDate).toBe("2026-06-26");
    expect(p.taxableSupplyDate).toBe("2026-06-12");
  });
  it("reads the variable symbol", () => {
    expect(p.variableSymbol).toBe("20260014");
  });
  it("reads VAT base, VAT total (not the rate) and grand total", () => {
    expect(p.vatBase).toBe(10000);
    expect(p.vatTotal).toBe(2100);
    expect(p.total).toBe(12100);
    expect(p.hasVat).toBe(true);
  });
  it("reads the buyer", () => {
    expect(p.buyer?.name).toBe("Klient a.s.");
    expect(p.buyer?.ico).toBe("99988877");
    expect(p.buyer?.dic).toBe("CZ99988877");
  });
});

describe("parseInvoiceText — empty / unrecognised", () => {
  it("never throws and reports hasVat false", () => {
    const p = parseInvoiceText("nothing useful here");
    expect(p.hasVat).toBe(false);
    expect(p.number).toBeUndefined();
    expect(p.buyer).toBeUndefined();
  });
});
