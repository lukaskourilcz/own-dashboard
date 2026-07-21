"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { qk } from "@/lib/queries/keys";
import { fetchSpendCategories } from "@/lib/queries/fetchers";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import type { SpendCategory } from "@/lib/types";

/**
 * The user-managed spend categories, backed by the `spend_categories` table and
 * shared across Subscriptions and Finances. Self-fetches (the list is tiny and
 * only needed inside the category picker), so it degrades gracefully to an
 * empty list if the table isn't there yet — the selector still works off the
 * categories already present in the data.
 */
export function useSpendCategories(): {
  categories: SpendCategory[];
  addCategory: (name: string) => void;
  removeCategory: (id: string) => void;
} {
  const qc = useQueryClient();
  const supabase = createClient();
  const toast = useToast();
  const t = useDict();

  const { data } = useQuery({
    queryKey: qk.spendCategories,
    queryFn: fetchSpendCategories,
    staleTime: 5 * 60_000,
    // A missing table (before the migration is run) shouldn't spam retries.
    retry: false,
  });
  const categories = data ?? [];

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const sortOrder =
        Math.max(0, ...categories.map((c) => c.sort_order)) + 1;
      const { data, error } = await supabase
        .from("spend_categories")
        .insert({ user_id: userId, name: trimmed, sort_order: sortOrder })
        .select()
        .single();
      if (error) {
        // 23505 = unique violation → it already exists; treat as a no-op.
        if ((error as { code?: string }).code === "23505") return null;
        throw error;
      }
      return data as SpendCategory;
    },
    onSuccess: (row) => {
      if (!row) return;
      qc.setQueryData<SpendCategory[]>(qk.spendCategories, (prev) => [
        ...(prev ?? []),
        row,
      ]);
    },
    onError: () => toast.err(t.categories.saveErr),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("spend_categories")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.spendCategories });
      const prev = qc.getQueryData<SpendCategory[]>(qk.spendCategories);
      qc.setQueryData<SpendCategory[]>(qk.spendCategories, (old) =>
        (old ?? []).filter((c) => c.id !== id),
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.spendCategories, ctx.prev);
      toast.err(t.categories.saveErr);
    },
  });

  return {
    categories,
    addCategory: (name: string) => addMutation.mutate(name),
    removeCategory: (id: string) => removeMutation.mutate(id),
  };
}
