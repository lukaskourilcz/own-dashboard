"use client";

import { useQuery } from "@tanstack/react-query";
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
 * The marketing calendars, read once per page session and shared by IG TIPS
 * and the Work overview through one query key. `preview` is the fixture the
 * public tour and the preview harness pass instead of reading GitHub.
 */
export function useMarketingCalendars(preview?: MarketingCalendarsResponse) {
  const query = useQuery({
    queryKey: qk.marketingCalendars,
    queryFn: loadMarketingCalendars,
    enabled: !preview,
    staleTime: 30 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
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
    checkAgain: () => void query.refetch(),
  };
}
