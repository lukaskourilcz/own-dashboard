// Currency conversion. Rates are "1 unit of this currency in USD".
//
// A hardcoded snapshot is the fallback; live rates (fetched from the free,
// keyless Frankfurter API — see use-fx.ts) are applied at runtime via
// applyLiveRates() and take over when available. convert() stays synchronous
// so every call site is unchanged — it just reads whichever rate table is
// active.
const FALLBACK_RATES_IN_USD: Record<string, number> = {
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
export const FX_SNAPSHOT_KEY = "fxRatesInUsd";

// Live rates, once fetched. Null until applyLiveRates() runs — kept null on the
// server and on the first client render so SSR and hydration agree (both use
// the fallback), avoiding a hydration mismatch on displayed amounts.
let liveRates: Record<string, number> | null = null;

/** Install a live rate table (values are "1 unit in USD"). USD is pinned to 1.
 * Persists a snapshot so the next reload can seed from it. */
export function applyLiveRates(ratesInUsd: Record<string, number>): void {
  const next: Record<string, number> = { USD: 1 };
  for (const [cur, rate] of Object.entries(ratesInUsd)) {
    if (typeof rate === "number" && rate > 0) next[cur] = rate;
  }
  liveRates = next;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(FX_SNAPSHOT_KEY, JSON.stringify(next));
    } catch {
      // ignore — quota or privacy mode; the fallback still works.
    }
  }
}

/** The last-good live snapshot from localStorage, or null. Used as seed data
 * so conversions are live immediately after mount on a reload. */
export function readFxSnapshot(): Record<string, number> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FX_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
    return null;
  } catch {
    return null;
  }
}

function activeRates(): Record<string, number> {
  return liveRates ?? FALLBACK_RATES_IN_USD;
}

export function convert(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  const rates = activeRates();
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!fromRate || !toRate) return amount;
  return (amount * fromRate) / toRate;
}
