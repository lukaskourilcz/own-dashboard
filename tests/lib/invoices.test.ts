import { describe, it, expect } from "vitest";
import {
  addDaysKey,
  buildSpayd,
  computeTotals,
  czAccountToIban,
  defaultVariableSymbol,
  effectiveStatus,
  isOverdue,
  lineBase,
  lineTotal,
  lineVat,
  resolveIban,
  round2,
  suggestInvoiceNumber,
  vatBreakdown,
  type ItemLike,
} from "@/lib/invoices";
import type { Invoice } from "@/lib/types";

function item(overrides: Partial<ItemLike> = {}): ItemLike {
  return { quantity: 1, unit_price: 100, vat_rate: 21, ...overrides };
}

describe("line math", () => {
  it("base is quantity × unit price", () => {
    expect(lineBase(item({ quantity: 3, unit_price: 250 }))).toBe(750);
  });
  it("vat applies the rate to the base", () => {
    expect(lineVat(item({ quantity: 1, unit_price: 100, vat_rate: 21 }))).toBe(21);
    expect(lineVat(item({ quantity: 2, unit_price: 100, vat_rate: 12 }))).toBe(24);
    expect(lineVat(item({ vat_rate: 0 }))).toBe(0);
  });
  it("total is base + vat", () => {
    expect(lineTotal(item({ quantity: 1, unit_price: 100, vat_rate: 21 }))).toBe(121);
  });
  it("rounds to halere (2 decimals)", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(lineVat(item({ quantity: 1, unit_price: 99.99, vat_rate: 21 }))).toBe(21);
  });
});

describe("vatBreakdown", () => {
  it("groups by rate, highest first", () => {
    const groups = vatBreakdown([
      item({ unit_price: 100, vat_rate: 21 }),
      item({ unit_price: 200, vat_rate: 12 }),
      item({ unit_price: 50, vat_rate: 21 }),
    ]);
    expect(groups.map((g) => g.rate)).toEqual([21, 12]);
    expect(groups[0]).toMatchObject({ rate: 21, base: 150, vat: 31.5, total: 181.5 });
    expect(groups[1]).toMatchObject({ rate: 12, base: 200, vat: 24, total: 224 });
  });
});

describe("computeTotals", () => {
  it("sums base and VAT for a VAT payer", () => {
    const totals = computeTotals(
      [item({ quantity: 1, unit_price: 1000, vat_rate: 21 })],
      { roundTotal: false, currency: "CZK" },
    );
    expect(totals.subtotal).toBe(1000);
    expect(totals.vatTotal).toBe(210);
    expect(totals.rawTotal).toBe(1210);
    expect(totals.total).toBe(1210);
    expect(totals.rounding).toBe(0);
  });

  it("has no VAT for a non-payer (all 0 %)", () => {
    const totals = computeTotals([
      item({ quantity: 10, unit_price: 500, vat_rate: 0 }),
    ]);
    expect(totals.subtotal).toBe(5000);
    expect(totals.vatTotal).toBe(0);
    expect(totals.total).toBe(5000);
  });

  it("rounds the grand total to whole crowns for CZK when asked", () => {
    const totals = computeTotals(
      [item({ quantity: 1, unit_price: 100.4, vat_rate: 21 })],
      { roundTotal: true, currency: "CZK" },
    );
    // 100.40 + 21.08 = 121.48 → 121
    expect(totals.rawTotal).toBe(121.48);
    expect(totals.total).toBe(121);
    expect(totals.rounding).toBe(-0.48);
  });

  it("does not round non-CZK totals", () => {
    const totals = computeTotals(
      [item({ quantity: 1, unit_price: 100.4, vat_rate: 21 })],
      { roundTotal: true, currency: "EUR" },
    );
    expect(totals.total).toBe(121.48);
    expect(totals.rounding).toBe(0);
  });
});

describe("suggestInvoiceNumber", () => {
  const ref = new Date("2026-06-15T12:00:00");
  it("starts at <year>001 with no history", () => {
    expect(suggestInvoiceNumber([], ref)).toBe("2026001");
  });
  it("increments the highest sequence for the current year", () => {
    expect(
      suggestInvoiceNumber(
        [{ number: "2026001" }, { number: "2026004" }, { number: "2025009" }],
        ref,
      ),
    ).toBe("2026005");
  });
  it("ignores other years", () => {
    expect(suggestInvoiceNumber([{ number: "2025099" }], ref)).toBe("2026001");
  });
});

describe("defaultVariableSymbol", () => {
  it("keeps digits only, capped at 10", () => {
    expect(defaultVariableSymbol("2026001")).toBe("2026001");
    expect(defaultVariableSymbol("FA-2026/001")).toBe("2026001");
  });
});

describe("addDaysKey", () => {
  it("adds days within a yyyy-MM-dd key", () => {
    expect(addDaysKey("2026-06-15", 14)).toBe("2026-06-29");
    expect(addDaysKey("2026-01-31", 1)).toBe("2026-02-01");
  });
});

describe("czAccountToIban", () => {
  it("converts a prefixed account number", () => {
    expect(czAccountToIban("19-2000145399/0800")).toBe(
      "CZ6508000000192000145399",
    );
  });
  it("converts a plain account number", () => {
    expect(czAccountToIban("2000145399/0800")).toBe(
      "CZ7908000000002000145399",
    );
  });
  it("returns null for non-account input", () => {
    expect(czAccountToIban("not an account")).toBeNull();
    expect(czAccountToIban("CZ6508000000192000145399")).toBeNull();
  });
});

describe("resolveIban", () => {
  it("prefers an explicit IBAN", () => {
    expect(
      resolveIban({ iban: "CZ65 0800 0000 1920 0014 5399", bank_account: "1/0100" }),
    ).toBe("CZ6508000000192000145399");
  });
  it("derives from the account number when no IBAN", () => {
    expect(resolveIban({ iban: null, bank_account: "19-2000145399/0800" })).toBe(
      "CZ6508000000192000145399",
    );
  });
  it("is null without either", () => {
    expect(resolveIban({ iban: null, bank_account: null })).toBeNull();
  });
});

describe("buildSpayd", () => {
  it("builds a minimal valid SPAYD string", () => {
    expect(
      buildSpayd({ iban: "CZ6508000000192000145399", amount: 1210 }),
    ).toBe("SPD*1.0*ACC:CZ6508000000192000145399*AM:1210.00*CC:CZK");
  });
  it("includes VS, due date and a sanitised message", () => {
    const s = buildSpayd({
      iban: "CZ6508000000192000145399",
      amount: 1500.5,
      currency: "CZK",
      variableSymbol: "2026001",
      message: "Faktura *2026001*",
      dueDate: "2026-06-29",
    });
    expect(s).toBe(
      "SPD*1.0*ACC:CZ6508000000192000145399*AM:1500.50*CC:CZK*X-VS:2026001*DT:20260629*MSG:Faktura  2026001",
    );
  });
});

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "i",
    user_id: "u",
    number: "2026001",
    variable_symbol: "2026001",
    constant_symbol: null,
    issue_date: "2026-06-01",
    due_date: "2026-06-15",
    taxable_supply_date: null,
    payment_method: "bank",
    currency: "CZK",
    status: "issued",
    paid_on: null,
    round_total: true,
    buyer_name: "ACME s.r.o.",
    buyer_address: null,
    buyer_city: null,
    buyer_zip: null,
    buyer_country: "Česká republika",
    buyer_ico: null,
    buyer_dic: null,
    supplier_name: "Jan Novák",
    supplier_address: null,
    supplier_city: null,
    supplier_zip: null,
    supplier_country: "Česká republika",
    supplier_ico: null,
    supplier_dic: null,
    supplier_is_vat_payer: false,
    bank_account: null,
    iban: null,
    note: null,
    footer_note: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("isOverdue / effectiveStatus", () => {
  const now = new Date("2026-06-20T10:00:00");
  it("flags an issued invoice past its due date", () => {
    expect(isOverdue(invoice({ due_date: "2026-06-15" }), now)).toBe(true);
    expect(effectiveStatus(invoice({ due_date: "2026-06-15" }), now)).toBe("overdue");
  });
  it("is not overdue before the due date", () => {
    expect(isOverdue(invoice({ due_date: "2026-06-25" }), now)).toBe(false);
    expect(effectiveStatus(invoice({ due_date: "2026-06-25" }), now)).toBe("issued");
  });
  it("paid and cancelled are never overdue", () => {
    expect(isOverdue(invoice({ status: "paid", due_date: "2026-01-01" }), now)).toBe(false);
    expect(effectiveStatus(invoice({ status: "paid", due_date: "2026-01-01" }), now)).toBe("paid");
    expect(effectiveStatus(invoice({ status: "cancelled", due_date: "2026-01-01" }), now)).toBe("cancelled");
  });
});

describe("payment QR input integrity", () => {
  const iban = "CZ6508000000192000145399";
  it.each(["not-an-account", "CZ6508000000192000145398", "CZ6508000000192000145399*AM:999.00"])("refuses an invalid explicit account without silently substituting the domestic account (%s)", value => {
    expect(resolveIban({ iban: value, bank_account: "19-2000145399/0800" })).toBeNull();
    expect(buildSpayd({ iban: value, amount: 1 })).toBeNull();
  });
  it.each([NaN, Infinity, -Infinity, -1, 0, 10_000_000, 1e21])("does not encode an unpayable or out-of-format amount %s", amount => {
    expect(buildSpayd({ iban, amount })).toBeNull();
  });
  it.each(["CZK*AM:999.00", "CZ", "123", "ZZZ", "CZK\nACC:OTHER"])("refuses malformed currency fields (%s)", currency => {
    expect(buildSpayd({ iban, amount: 1, currency })).toBeNull();
  });
  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-01-00", "20260101", "2026-01-01*AM:999.00"])("refuses an impossible or injected due date (%s)", dueDate => {
    expect(buildSpayd({ iban, amount: 1, dueDate })).toBeNull();
  });
  it("preserves valid amount boundaries, lowercase currency and leap dates", () => {
    expect(buildSpayd({ iban, amount: 9_999_999.99, currency: "czk", dueDate: "2028-02-29" })).toBe("SPD*1.0*ACC:CZ6508000000192000145399*AM:9999999.99*CC:CZK*DT:20280229");
    expect(buildSpayd({ iban, amount: 0.01 })).toContain("AM:0.01");
  });
  it.each(["1/0100", "18-2000145399/0800", "0/0800", "19-2000145399/0000"])("refuses an invalid domestic checksum or empty account/bank (%s)", value => {
    expect(czAccountToIban(value)).toBeNull();
  });
});


it("preserves a published foreign IBAN example without a domestic fallback", () => {
  expect(resolveIban({ iban: "BE62 5100 0754 7061", bank_account: null })).toBe("BE62510007547061");
  expect(buildSpayd({ iban: "BE62510007547061", amount: 12, currency: "EUR" })).toBe("SPD*1.0*ACC:BE62510007547061*AM:12.00*CC:EUR");
});
it("refuses malformed or excessive optional payment fields without throwing", () => {
  const base = { iban: "CZ6508000000192000145399", amount: 1 };
  for (const patch of [{ variableSymbol: 7 }, { constantSymbol: {} }, { message: false }, { currency: null }, { dueDate: 0 }, { variableSymbol: "1".repeat(129) }, { message: "x".repeat(4097) }]) {
    expect(buildSpayd({ ...base, ...patch } as unknown as Parameters<typeof buildSpayd>[0])).toBeNull();
  }
});

it("keeps a recognized legacy currency outside the static FX list", () => {
  expect(buildSpayd({ iban: "BE62510007547061", amount: 1200, currency: "JPY" })).toContain("CC:JPY");
});
