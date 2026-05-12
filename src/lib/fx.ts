// Static FX table. Each value is "1 unit of this currency in USD" — a rough
// snapshot, not a live rate.
// TODO: fetch live rates from an FX API (e.g. open.er-api.com / Frankfurter)
//       and cache for a few hours; persist the last-good snapshot.
const RATES_IN_USD: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CZK: 0.043,
  CAD: 0.74,
};

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CZK", "CAD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export function convert(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  const fromRate = RATES_IN_USD[from];
  const toRate = RATES_IN_USD[to];
  if (!fromRate || !toRate) return amount;
  return (amount * fromRate) / toRate;
}
