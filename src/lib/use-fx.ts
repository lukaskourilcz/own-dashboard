"use client";

import { useQuery } from "@tanstack/react-query";
import {
  applyLiveRates,
  readFxSnapshot,
  SUPPORTED_CURRENCIES,
} from "@/lib/fx";

/** Fetch live rates from Frankfurter (free, keyless, ECB data). The API returns
 * "units of each currency per 1 USD"; we invert to "1 unit in USD" to match the
 * table convert() expects. */
async function fetchFxRatesInUsd(): Promise<Record<string, number>> {
  const symbols = SUPPORTED_CURRENCIES.filter((c) => c !== "USD").join(",");
  const res = await fetch(
    `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${symbols}`,
  );
  if (!res.ok) throw new Error("fx-fetch-failed");
  const json = (await res.json()) as { rates?: Record<string, number> };
  const perUsd = json.rates ?? {};
  const inUsd: Record<string, number> = { USD: 1 };
  for (const [cur, rate] of Object.entries(perUsd)) {
    if (typeof rate === "number" && rate > 0) inUsd[cur] = 1 / rate;
  }
  return inUsd;
}

/**
 * Keep the module-level FX table live. Mount this once high in the tree (the
 * dashboard shell). It seeds from the last-good localStorage snapshot so
 * conversions are live right after a reload, then refetches in the background.
 * Frankfurter publishes ~daily, so an all-day staleTime is plenty. On any
 * failure convert() silently keeps using the current table (snapshot or the
 * hardcoded fallback).
 */
export function useFxRates() {
  const query = useQuery({
    queryKey: ["fx", "rates"],
    queryFn: fetchFxRatesInUsd,
    initialData: () => readFxSnapshot() ?? undefined,
    // Treat the seeded snapshot as stale so a fresh copy is fetched on mount,
    // while conversions already use the snapshot in the meantime.
    initialDataUpdatedAt: 0,
    staleTime: 12 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // Sync the fetched (or seeded) table into the module cache so the synchronous
  // convert() picks it up. Idempotent, so running during render is safe.
  if (query.data) applyLiveRates(query.data);

  return query;
}
