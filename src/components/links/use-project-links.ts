"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import type { ProjectLink, ProjectLinkRole, Updater } from "@/lib/types";

export type NewProjectLink = {
  project_id: string;
  ai_link_id: string;
  role?: ProjectLinkRole;
  note?: string;
  sort_order?: number;
};
type Patch = Partial<Pick<ProjectLink, "note" | "role" | "sort_order">>;
type Options = { message?: string; silent?: boolean; expectedUpdatedAt?: string };
type Operation = { kind: "upsert"; rows: NewProjectLink[] }
  | { kind: "update"; id: string; patch: Patch; expectedUpdatedAt?: string }
  | { kind: "remove"; ids: string[] };
const pair = (row: Pick<ProjectLink, "project_id" | "ai_link_id">) => `${row.project_id}:${row.ai_link_id}`;

/** Shared ordered writes retain own/parent RLS. Rejected requests reconcile
 * their cache; rollback restores only affected fields/rows, never a whole
 * stale library. Update versions reject a stale editor across browser tabs.
 */
export function useProjectLinkMutations(setProjectLinks: Updater<ProjectLink[]>, currentRows: ProjectLink[] = []) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useDict();
  const { mutateAsync, isPending } = useMutation({
    scope: { id: "project-link-writes" },
    mutationFn: async (operation: Operation): Promise<ProjectLink[]> => {
      const supabase = createClient();
      if (operation.kind === "upsert") {
        const userId = await currentUserId(supabase);
        if (!userId) throw new Error("no-user");
        const wanted = new Set(operation.rows.map(pair));
        if (wanted.size !== operation.rows.length) throw new Error("Duplicate project resources");
        const { data, error } = await supabase.from("project_links").upsert(operation.rows.map(row => ({
          user_id: userId, project_id: row.project_id, ai_link_id: row.ai_link_id,
          role: row.role ?? "uses", note: row.note ?? "", sort_order: row.sort_order ?? 0,
          updated_at: new Date().toISOString(),
        })), { onConflict: "project_id,ai_link_id" }).select();
        if (error || !Array.isArray(data) || data.length !== wanted.size
          || data.some(row => typeof row.id !== "string" || row.user_id !== userId || !wanted.has(pair(row)))
          || new Set(data.map(pair)).size !== wanted.size) throw new Error("Project resources not confirmed");
        const saved = data as ProjectLink[];
        setProjectLinks(previous => [...previous.filter(row => !wanted.has(pair(row))), ...saved]);
        return saved;
      }
      await qc.cancelQueries({ queryKey: qk.projectLinks });
      const snapshot = qc.getQueryData<ProjectLink[]>(qk.projectLinks) ?? currentRows;
      if (operation.kind === "update") {
        const previous = snapshot.find(row => row.id === operation.id);
        if (!previous) throw new Error("Project resource unavailable");
        setProjectLinks(rows => rows.map(row => row.id === operation.id ? { ...row, ...operation.patch } : row));
        try {
          const { data, error } = await supabase.from("project_links")
            .update({ ...operation.patch, updated_at: new Date().toISOString() })
            .eq("id", operation.id).eq("updated_at", operation.expectedUpdatedAt ?? previous.updated_at).select().single();
          if (error || !data || data.id !== operation.id || data.user_id !== previous.user_id || pair(data) !== pair(previous) || typeof data.updated_at !== "string") throw new Error("Project resource update not confirmed");
          setProjectLinks(rows => rows.map(row => row.id === operation.id ? data as ProjectLink : row));
          return [data as ProjectLink];
        } catch (error) {
          setProjectLinks(rows => rows.map(row => {
            if (row.id !== operation.id) return row;
            const restored = { ...row };
            for (const key of Object.keys(operation.patch) as (keyof Patch)[]) {
              if (row[key] === operation.patch[key]) Object.assign(restored, { [key]: previous[key] });
            }
            return restored;
          }));
          throw error;
        }
      }
      const ids = new Set(operation.ids);
      const removed = snapshot.filter(row => ids.has(row.id));
      setProjectLinks(rows => rows.filter(row => !ids.has(row.id)));
      try {
        const { error } = await supabase.from("project_links").delete().in("id", operation.ids);
        if (error) throw error;
        return [];
      } catch (error) {
        setProjectLinks(rows => {
          const existing = new Set(rows.map(pair));
          return [...rows, ...removed.filter(row => !existing.has(pair(row)))];
        });
        throw error;
      }
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: qk.projectLinks }); },
  });
  const perform = useCallback(async (operation: Operation, options: Options): Promise<ProjectLink[] | null> => {
    try {
      const rows = await mutateAsync(operation);
      if (!options.silent) toast.ok(options.message ?? (operation.kind === "remove" ? t.ai.relationRemoved : operation.kind === "update" ? t.ai.relationSaved : t.ai.relationAdded));
      return rows;
    } catch (error) {
      if (!options.silent) toast.err(error instanceof Error && error.message === "no-user" ? t.ai.signInFirst : t.ai.relationFailed);
      return null;
    }
  }, [mutateAsync, t, toast]);
  const upsert = useCallback((rows: NewProjectLink[], options: Options = {}) => rows.length
    ? perform({ kind: "upsert", rows }, options) : Promise.resolve([]), [perform]);
  const update = useCallback(async (id: string, patch: Patch, options: Options = {}) =>
    await perform({ kind: "update", id, patch, expectedUpdatedAt: options.expectedUpdatedAt }, options) !== null, [perform]);
  const remove = useCallback(async (ids: string[], options: Options = {}) => ids.length === 0
    || await perform({ kind: "remove", ids }, options) !== null, [perform]);
  return { upsert, update, remove, pending: isPending };
}
