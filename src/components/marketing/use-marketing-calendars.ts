"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import {
  loadMarketingCalendars,
  type MarketingCalendarsResponse,
  type MarketingCalendarsResult,
  type CalendarReadStatus,
} from "@/lib/marketing-calendars";
import { qk } from "@/lib/queries/keys";

/** What a panel knows about the marketing calendars right now. */
export type MarketingView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "rate-limited" }
  | { kind: "signed-out" }
  | { kind: "ok"; data: MarketingCalendarsResponse };

export type MarketingRefreshError = 'error' | 'rate-limited';
class CalendarReadFailure extends Error {
  constructor(readonly kind: MarketingRefreshError) { super('Calendar read unavailable'); }
}
const transientSourceFailures = new Set<CalendarReadStatus>(['error', 'too-large', 'invalid-json', 'wrong-schema']);

/**
 * The marketing calendars, cached for 30 minutes and shared by IG TIPS
 * and the Work overview through one query key. Reopening a stale destination
 * or an explicit check refreshes; focus alone does not. `preview` is the fixture the
 * public tour and the preview harness pass instead of reading GitHub.
 */
export function useMarketingCalendars(preview?: MarketingCalendarsResponse) {
  const client = useQueryClient();
  const refreshOrigin = useRef<HTMLButtonElement | null>(null);
  const query = useQuery({
    queryKey: qk.marketingCalendars,
    queryFn: async ({ signal }) => {
      const result = await loadMarketingCalendars(signal);
      signal.throwIfAborted();
      if (result.kind === 'error' || result.kind === 'rate-limited') throw new CalendarReadFailure(result.kind);
      const previous = client.getQueryData<MarketingCalendarsResult>(qk.marketingCalendars);
      if (result.kind === 'ok' && previous?.kind === 'ok') {
        const failed = result.data.sources.find(next => transientSourceFailures.has(next.status) && previous.data.sources.some(before => before.id === next.id && before.status === 'ok'));
        if (failed) throw new CalendarReadFailure(failed.detail === '429' ? 'rate-limited' : 'error');
      }
      return result;
    },
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
  const failure: MarketingRefreshError = query.error instanceof CalendarReadFailure ? query.error.kind : 'error';
  const view: MarketingView = preview
    ? { kind: "ok", data: preview }
    : query.data
      ? query.data
      : query.isError
        ? { kind: failure }
        : { kind: "loading" };
  return {
    view,
    checking: !preview && query.isFetching,
    canCheck: !preview,
    refreshError: !preview && query.isError && query.data?.kind === 'ok' ? failure : null,
    checkAgain: (event?: MouseEvent<HTMLButtonElement>) => { if (preview) return; refreshOrigin.current = event?.currentTarget ?? null; void query.refetch(); },
  };
}
