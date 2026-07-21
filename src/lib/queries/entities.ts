"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { Updater } from "@/lib/types";

/**
 * React Query as a client-side store for route-scoped dashboard data.
 *
 * The initial destination is seeded by the server. Other entities receive an
 * epoch-dated placeholder and remain disabled until their destination is
 * opened, then fetch through the canonical query function. Seeded records are
 * fresh for five minutes; invalidation after mutations still refetches them.
 *
 * The returned `[data, setData]` tuple mirrors `useState`, so panels that still
 * consume props keep their exact existing interface.
 */
export function useEntityStore<T>(
  key: QueryKey,
  initialData: T,
  queryFn?: () => Promise<T> | T,
  options?: { enabled?: boolean; seeded?: boolean },
): [T, Updater<T>] {
  const qc = useQueryClient();
  const seeded = options?.seeded ?? true;
  const { data } = useQuery({
    queryKey: key,
    queryFn: queryFn ?? (() => qc.getQueryData<T>(key) as T),
    initialData,
    // Unseeded values are empty transport placeholders, not fresh canonical
    // data. Timestamping them at the epoch makes the first enabled view fetch
    // immediately while preserving server-seeded data for five minutes.
    initialDataUpdatedAt: seeded ? undefined : 0,
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
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

  // `data` is always defined through initial data, but React Query widens it
  // to T | undefined for a generic value — assert back.
  return [data as T, setData];
}
