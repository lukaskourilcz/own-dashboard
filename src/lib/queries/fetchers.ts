"use client";

import { createClient } from "@/lib/supabase/client";
import type { Todo } from "@/lib/types";

/**
 * Client-side Supabase fetchers used as React Query `queryFn`s, so an
 * `invalidateQueries` after a mutation refetches the canonical rows. Each
 * mirrors the corresponding server load in `dashboard/page.tsx`; RLS already
 * scopes results to the current user (and shared rows where applicable), so the
 * explicit user filter is unnecessary client-side.
 */

export async function fetchTodos(): Promise<Todo[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("todos")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Todo[];
}
