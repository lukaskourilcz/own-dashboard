"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { useSaveUserPreferences } from "@/lib/preference-client";
import { saveRepositoryFilter } from "@/lib/repository-filter-save";
import { useRef } from "react";

export function useRepositoryFilterSave(onSaved: () => void) {
  const toast = useToast(), t = useDict(), qc = useQueryClient();
  const savePreferences = useSaveUserPreferences();
  const pending = useRef(false);
  const mutation = useMutation({
    mutationFn: (ids: readonly string[]) => saveRepositoryFilter(ids, savePreferences),
    onSuccess: ({ device, server, current }) => {
      if (server) void qc.invalidateQueries({ queryKey: qk.userPreferences });
      if (!current) { toast.info(t.github.filterChanged); return; }
      onSaved();
      if (device && server) toast.ok(t.github.filterSaved);
      else toast.info(server ? t.github.filterServerOnly : t.github.filterLocalOnly);
    },
    onError: () => toast.err(t.github.filterErr),
  });
  return { ...mutation, save: async (ids: readonly string[]): Promise<boolean> => {
    if (pending.current) return false;
    pending.current = true;
    try { return (await mutation.mutateAsync(ids)).current; }
    catch { return false; }
    finally { pending.current = false; }
  } };
}
