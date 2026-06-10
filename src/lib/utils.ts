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
const LOCALE_BY_CURRENCY: Record<string, string> = {
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  CZK: "cs-CZ",
  CAD: "en-CA",
};

export function formatCurrency(value: number, currency = "USD") {
  const locale = LOCALE_BY_CURRENCY[currency] ?? "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
