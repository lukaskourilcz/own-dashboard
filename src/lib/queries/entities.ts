"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { Updater } from "@/lib/types";

/**
 * React Query as a client-side store for SSR-seeded dashboard data.
 *
 * Data is hydrated once from the server load via `initialData` and then mutated
 * by `useMutation` hooks (or the returned `Updater`). `staleTime: Infinity`
 * means it never auto-refetches — only an explicit `invalidateQueries` does,
 * which runs `queryFn` when one is supplied (entities migrated to mutations
 * pass a real Supabase fetcher; the rest fall back to a cache no-op).
 *
 * The returned `[data, setData]` tuple mirrors `useState`, so panels that still
 * consume props keep their exact existing interface.
 */
export function useEntityStore<T>(
  key: QueryKey,
  initialData: T,
  queryFn?: () => Promise<T> | T,
): [T, Updater<T>] {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: key,
    queryFn: queryFn ?? (() => qc.getQueryData<T>(key) as T),
    initialData,
    staleTime: Infinity,
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

  // `data` is always defined (seeded via initialData, never stale), but React
  // Query widens it to T | undefined for a generic initialData — assert back.
  return [data as T, setData];
}
