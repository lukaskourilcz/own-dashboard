"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useOwnerPreferences } from "@/lib/owner-preferences";
import { useGuestPreferences } from "@/lib/guest-preferences";
import { qk } from "@/lib/queries/keys";
import { fetchSpendCategories } from "@/lib/queries/fetchers";
import { awaitWithSignal } from "@/lib/abortable";
import { createSpendCategoryRecord, removeSpendCategoryRecord, orderSpendCategories, SpendCategoryError, type SpendCategoryIntent } from "@/lib/spend-category-records";
import type { SpendCategory } from "@/lib/types";

const EMPTY_CATEGORIES: readonly SpendCategory[] = Object.freeze([]);

/** Only confirmed owned rows enter the shared picker cache. Existing entity
 * category strings remain independent of this optional managed list. */
export function useSpendCategories() {
  const client = useQueryClient(), owner = useOwnerPreferences(), guest = useGuestPreferences();
  const ownerId = owner?.ownerId ?? "unavailable";
  const readOnly = !!guest || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId);
  const key = useMemo(() => [...qk.spendCategories, ownerId], [ownerId]);
  const mounted = useRef(false), actor = useRef(ownerId), requests = useRef(new Set<AbortController>());
  const intent = useRef<SpendCategoryIntent | null>(null);
  useEffect(() => {
    mounted.current = true; const active = requests.current;
    return () => { mounted.current = false; for (const request of active) request.abort(); active.clear(); };
  }, []);
  useLayoutEffect(() => { actor.current = ownerId; for (const request of requests.current) request.abort(); intent.current = null; }, [ownerId]);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => fetchSpendCategories({ ownerId, signal }), enabled: !readOnly, staleTime: 5 * 60_000, retry: false });
  const ready = !readOnly && query.isSuccess && !query.isFetching;
  const categories = query.data ?? EMPTY_CATEGORIES;

  const capture = useCallback(() => {
    if (!owner || readOnly || !mounted.current) throw new SpendCategoryError();
    const captured = owner.capture(), controller = new AbortController(); requests.current.add(controller);
    return { ownerId: captured.ownerId, signal: AbortSignal.any([captured.signal, controller.signal, AbortSignal.timeout(15_000)]), controller };
  }, [owner, readOnly]);
  const addCategory = useCallback(async (name: string) => {
    if (!ready) throw new SpendCategoryError();
    const captured = capture(), trimmed = name.trim();
    if (!intent.current || intent.current.name !== trimmed) intent.current = { id: crypto.randomUUID(), name: trimmed, sortOrder: Math.min(2147483647, Math.max(0, ...categories.map(row => row.sort_order)) + 1) };
    const command = structuredClone(intent.current);
    try {
      await awaitWithSignal(client.cancelQueries({ queryKey: key, exact: true }), captured.signal);
      const row = await createSpendCategoryRecord(createClient(), captured, command);
      if (!mounted.current || actor.current !== captured.ownerId || captured.signal.aborted) throw new SpendCategoryError();
      client.setQueryData<SpendCategory[]>(key, previous => orderSpendCategories([...(previous ?? []).filter(item => item.id !== row.id), row]));
      intent.current = null; return row;
    } finally { requests.current.delete(captured.controller); }
  }, [ready, capture, categories, client, key]);
  const removeCategory = useCallback(async (row: SpendCategory) => {
    if (!ready) throw new SpendCategoryError();
    const captured = capture(), expected = structuredClone(row);
    try {
      await awaitWithSignal(client.cancelQueries({ queryKey: key, exact: true }), captured.signal);
      await removeSpendCategoryRecord(createClient(), captured, expected);
      if (!mounted.current || actor.current !== captured.ownerId || captured.signal.aborted) throw new SpendCategoryError();
      client.setQueryData<SpendCategory[]>(key, previous => (previous ?? []).filter(item => item.id !== expected.id));
    } finally { requests.current.delete(captured.controller); }
  }, [ready, capture, client, key]);

  return { categories, ready, readOnly, failed: !readOnly && query.isError, loading: !readOnly && query.isPending,
    refreshing: query.isFetching, reload: () => readOnly ? Promise.resolve(undefined) : query.refetch(), addCategory, removeCategory };
}
