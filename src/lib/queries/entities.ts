"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { Updater } from "@/lib/types";

/**
 * React Query as a client-side store for SSR-seeded dashboard data.
 *
 * Data is hydrated once from the server load via `initialData` and then mutated
 * in place by the panels through the returned `Updater` (which writes straight
 * to the query cache). `staleTime: Infinity` means it never auto-refetches —
 * the cache is the source of truth after hydration, and persistence still goes
 * through Supabase inside the panels. The returned `[data, setData]` tuple
 * mirrors `useState`, so panels keep their exact existing interface.
 */
export function useEntityStore<T>(
  key: QueryKey,
  initialData: T,
): [T, Updater<T>] {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: key,
    // Never actually fires (seeded + never stale); returns the cache if asked.
    queryFn: () => qc.getQueryData<T>(key) as T,
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
