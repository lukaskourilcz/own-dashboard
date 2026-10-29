import { afterEach, expect, it, vi } from "vitest";
import { convert } from "@/lib/fx";
const locales = { USD: "en-US", EUR: "de-DE", GBP: "en-GB", CZK: "cs-CZ", CAD: "en-CA" };
function trackFormatters() {
  const NativeNumberFormat = Intl.NumberFormat;
  // Vitest's default constructor spy loses Intl's native internal slots.
  return vi.spyOn(Intl, "NumberFormat").mockImplementation(function (locales, options) { return new NativeNumberFormat(locales, options); });
}
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });
it("retains existing native grouping, signs, decimals and symbols for every supported currency", async () => {
  const { formatCurrency } = await import("@/lib/utils");
  for (const [currency, locale] of Object.entries(locales)) for (const value of [0, -0, 0.001, -12.345, 1234.56, 123456789.99]) {
    expect(formatCurrency(value, currency)).toBe(new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(value));
  }
  expect(formatCurrency(1234.56)).toBe("$1,234.56"); expect(formatCurrency(1234.56, "CZK")).toBe("1 234,56 Kč");
});
it("normalizes supported currency casing and spacing without changing their native locale", async () => {
  const { formatCurrency } = await import("@/lib/utils");
  for (const currency of Object.keys(locales)) expect(formatCurrency(1234.56, ` ${currency.toLowerCase()} `)).toBe(formatCurrency(1234.56, currency));
});
it("reuses exactly the five supported stateless formatters across repeated values", async () => {
  const { formatCurrency } = await import("@/lib/utils"), spy = trackFormatters();
  for (let i = 0; i < 100; i++) for (const currency of Object.keys(locales)) formatCurrency(i, currency);
  expect(spy).toHaveBeenCalledTimes(5);
});
it("does not grow a shared cache for arbitrary well-formed legacy currency codes", async () => {
  const { formatCurrency } = await import("@/lib/utils"), spy = trackFormatters();
  for (const currency of ["NZD", "NOK", "SEK", "ZZZ"]) {
    const first = formatCurrency(1234.56, currency); expect(formatCurrency(1234.56, currency)).toBe(first);
    expect(first).not.toBe(formatCurrency(1234.56));
  }
  expect(spy).toHaveBeenCalledTimes(9); // Eight uncached legacy calls, one USD.
});
it("keeps a known amount visible with an unknown-currency marker instead of inventing dollars or throwing", async () => {
  const { formatCurrency } = await import("@/lib/utils");
  for (const currency of ["", "EURO", "US$", "US\0D", "💶", "x".repeat(2000), "constructor", "toString", "__proto__", null, 123]) {
    expect(formatCurrency(1234.5, currency as string)).toBe("1,234.50 —");
  }
});
it("does not render NaN or infinity as a financial amount", async () => {
  const { formatCurrency } = await import("@/lib/utils");
  for (const value of [NaN, Infinity, -Infinity]) for (const currency of ["USD", "", "CZK"]) expect(formatCurrency(value, currency)).toBe("—");
});
it("keeps the documented static FX behavior without reading inherited object properties as exchange rates", () => {
  expect(convert(100, "EUR", "USD")).toBe(108); expect(convert(108, "USD", "EUR")).toBe(100);
  for (const unsupported of ["constructor", "toString", "__proto__", "NOK"]) {
    expect(convert(100, unsupported, "USD")).toBe(100); expect(convert(100, "USD", unsupported)).toBe(100);
  }
});
