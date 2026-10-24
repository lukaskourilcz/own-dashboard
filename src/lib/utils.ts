import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Pick a sensible locale per currency so each amount formats with its native
// grouping/decimal/symbol conventions (e.g. CZK → "1 234,56 Kč", USD →
// "$1,234.56"). Keyed off the currency code — which lives in the data — so the
// result is identical on the server and client (no hydration mismatch),
// independent of the chosen UI language.
const LOCALE_BY_CURRENCY = new Map([
  ["USD", "en-US"], ["EUR", "de-DE"], ["GBP", "en-GB"], ["CZK", "cs-CZ"], ["CAD", "en-CA"],
]);
// At most five shared, stateless formatters; no user values enter this cache.
const currencyFormats = new Map<string, Intl.NumberFormat>();
let unknownCurrencyFormat: Intl.NumberFormat | undefined;

export function formatCurrency(value: number, currency = "USD") {
  if (!Number.isFinite(value)) return "—";
  const code = typeof currency === "string" && currency.length <= 16 ? currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(code)) {
    // Keep the known amount, mark its missing/invalid currency and never
    // silently relabel it USD or let a malformed legacy value crash a page.
    unknownCurrencyFormat ??= new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${unknownCurrencyFormat.format(value)} —`;
  }
  const locale = LOCALE_BY_CURRENCY.get(code);
  let formatter = currencyFormats.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale ?? "en-US", { style: "currency", currency: code, maximumFractionDigits: 2 });
    // Other well-formed legacy currencies still display their own code, but
    // arbitrary input must not grow a cross-request formatter cache.
    if (locale) currencyFormats.set(code, formatter);
  }
  return formatter.format(value);
}
