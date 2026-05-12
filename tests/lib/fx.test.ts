import { describe, it, expect } from "vitest";
import { SUPPORTED_CURRENCIES, convert } from "@/lib/fx";

describe("fx.convert", () => {
  it("returns the same amount when source and target match", () => {
    expect(convert(100, "USD", "USD")).toBe(100);
    expect(convert(50, "EUR", "EUR")).toBe(50);
  });

  it("passes through unknown currencies (degrades gracefully)", () => {
    expect(convert(100, "XXX", "USD")).toBe(100);
    expect(convert(100, "USD", "XXX")).toBe(100);
  });

  it("converts EUR -> USD using the rate table", () => {
    // EUR=1.08 (in USD), USD=1. 100 EUR -> ~108 USD.
    expect(convert(100, "EUR", "USD")).toBeCloseTo(108, 2);
  });

  it("converts USD -> EUR using the inverse rate", () => {
    // 100 USD -> 100 / 1.08 EUR -> ~92.59 EUR.
    expect(convert(100, "USD", "EUR")).toBeCloseTo(92.59, 1);
  });

  it("converts EUR -> GBP via the USD pivot", () => {
    // 100 EUR -> 108 USD -> 108 / 1.27 GBP -> ~85.04 GBP.
    expect(convert(100, "EUR", "GBP")).toBeCloseTo(85.04, 0);
  });
});

describe("fx.SUPPORTED_CURRENCIES", () => {
  it("includes the canonical set the UI offers", () => {
    expect(SUPPORTED_CURRENCIES).toEqual(["USD", "EUR", "GBP", "CZK", "CAD"]);
  });
});
