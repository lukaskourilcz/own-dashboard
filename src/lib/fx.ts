// Deterministic static conversion. Rates are "1 unit of this currency in USD".
// This product intentionally does not fetch live FX; all financial surfaces use
// the same predictable table and make no background third-party request.
const RATES_IN_USD: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CZK: 0.043,
  CAD: 0.74,
};

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CZK", "CAD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** Device-local key for the last-good live snapshot, so reloads start from
 * live rates instead of the stale hardcoded fallback. */
export function convert(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  const fromRate = RATES_IN_USD[from];
  const toRate = RATES_IN_USD[to];
  if (!fromRate || !toRate) return amount;
  return (amount * fromRate) / toRate;
}
