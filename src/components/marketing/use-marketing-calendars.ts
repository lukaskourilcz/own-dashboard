"use client";

import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import {
  loadMarketingCalendars,
  type MarketingCalendarsResponse,
} from "@/lib/marketing-calendars";
import { qk } from "@/lib/queries/keys";

/** What a panel knows about the marketing calendars right now. */
export type MarketingView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "rate-limited" }
  | { kind: "signed-out" }
  | { kind: "ok"; data: MarketingCalendarsResponse };

/**
 * The marketing calendars, cached for 30 minutes and shared by IG TIPS
 * and the Work overview through one query key. Reopening a stale destination
 * or an explicit check refreshes; focus alone does not. `preview` is the fixture the
 * public tour and the preview harness pass instead of reading GitHub.
 */
export function useMarketingCalendars(preview?: MarketingCalendarsResponse) {
  const refreshOrigin = useRef<HTMLButtonElement | null>(null);
  const query = useQuery({
    queryKey: qk.marketingCalendars,
    queryFn: ({ signal }) => loadMarketingCalendars(signal),
    enabled: !preview,
    staleTime: 30 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  useLayoutEffect(() => {
    const original = refreshOrigin.current;
    if (!original || query.isFetching) return;
    refreshOrigin.current = null;
    if (!original.isConnected || (document.activeElement !== document.body && document.activeElement !== original)) return;
    original.focus();
  }, [query.isFetching, query.data, query.error]);
  const view: MarketingView = preview
    ? { kind: "ok", data: preview }
    : query.data
      ? query.data
      : query.isError
        ? { kind: "error" }
        : { kind: "loading" };
  return {
    view,
    checking: !preview && query.isFetching,
    canCheck: !preview,
    checkAgain: (event?: MouseEvent<HTMLButtonElement>) => { refreshOrigin.current = event?.currentTarget ?? null; void query.refetch(); },
  };
}
