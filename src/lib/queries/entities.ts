"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { Updater } from "@/lib/types";

/**
 * Whether a store holds real records yet.
 *
 * `ready` is false while the value is still the empty placeholder an unseeded
 * destination starts from; `failed` is true when that first fetch gave up.
 * Anything that writes a whole record back from what it read (a form, a flow
 * that upserts) must wait for `ready`, or it saves the placeholder over the
 * owner's data.
 */
export type EntityStatus = { ready: boolean; failed: boolean };

/**
 * React Query as a client-side store for route-scoped dashboard data.
 *
 * The initial destination is seeded by the server. Other entities receive an
 * epoch-dated placeholder and remain disabled until their destination is
 * opened, then fetch through the canonical query function. Seeded records are
 * fresh for five minutes; invalidation after mutations still refetches them.
 *
 * The returned `[data, setData]` pair mirrors `useState`, so panels that still
 * consume props keep their exact existing interface. The third element says
 * whether `data` is real yet (see `EntityStatus`).
 */
export function useEntityStore<T>(
  key: QueryKey,
  initialData: T,
  queryFn?: () => Promise<T> | T,
  options?: {
    enabled?: boolean;
    seeded?: boolean;
    /** On-demand data (Career, Opportunities) never goes stale by itself:
     * only the owner's "Check for new offers" fetches it again. */
    onDemand?: boolean;
  },
): [T, Updater<T>, EntityStatus] {
  const qc = useQueryClient();
  const seeded = options?.seeded ?? true;
  const { data, dataUpdatedAt, isError } = useQuery({
    queryKey: key,
    queryFn: queryFn ?? (() => qc.getQueryData<T>(key) as T),
    initialData,
    // Unseeded values are empty transport placeholders, not fresh canonical
    // data. Timestamping them at the epoch makes the first enabled view fetch
    // immediately while preserving server-seeded data for five minutes.
    initialDataUpdatedAt: seeded ? undefined : 0,
    enabled: options?.enabled ?? true,
    staleTime: options?.onDemand ? Infinity : 5 * 60 * 1000,
    refetchOnWindowFocus: options?.onDemand ? false : undefined,
    gcTime: Infinity,
  });

  const setData = useCallback<Updater<T>>(
    (next) => {
      qc.setQueryData<T>(key, (prev) =>
        typeof next === "function"
          ? (next as (p: T) => T)(prev as T)
          : next,
      );
    },
    [qc, key],
  );

  // A placeholder is dated at the epoch; server-seeded data, a finished fetch
  // and a cache write all carry a real timestamp.
  const ready = dataUpdatedAt > 0;
  const status = useMemo<EntityStatus>(
    () => ({ ready, failed: !ready && isError }),
    [ready, isError],
  );

  // `data` is always defined through initial data, but React Query widens it
  // to T | undefined for a generic value — assert back.
  return [data as T, setData, status];
}
