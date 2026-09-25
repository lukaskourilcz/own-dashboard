"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
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

/**
 * Writes to `project_links`, shared by the project workspace, the Links
 * library and the Tools section. Every mutation updates the shared cache
 * immediately and invalidates `qk.projectLinks` so the canonical rows follow.
 * RLS re-checks that the project and the link both belong to the owner.
 */
export function useProjectLinkMutations(setProjectLinks: Updater<ProjectLink[]>) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useDict();

  const settle = useCallback(
    () => void qc.invalidateQueries({ queryKey: qk.projectLinks }),
    [qc],
  );

  /** Insert or update by (project, link); returns the saved rows. Pass
   * `silent` when the caller reports the outcome itself. */
  const upsert = useCallback(
    async (rows: NewProjectLink[], options: { message?: string; silent?: boolean } = {}): Promise<ProjectLink[] | null> => {
      const message = options.message ?? t.ai.relationAdded;
      if (rows.length === 0) return [];
      const supabase = createClient();
      const userId = await currentUserId(supabase);
      if (!userId) {
        toast.err(t.ai.signInFirst);
        return null;
      }
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("project_links")
        .upsert(
          rows.map((row) => ({
            user_id: userId,
            project_id: row.project_id,
            ai_link_id: row.ai_link_id,
            role: row.role ?? "uses",
            note: row.note ?? "",
            sort_order: row.sort_order ?? 0,
            updated_at: now,
          })),
          { onConflict: "project_id,ai_link_id" },
        )
        .select();
      if (error || !data) {
        toast.err(t.ai.relationFailed);
        return null;
      }
      const saved = data as ProjectLink[];
      const ids = new Set(saved.map((row) => row.id));
      setProjectLinks((previous) => [
        ...previous.filter(
          (row) =>
            !ids.has(row.id) &&
            !saved.some((next) => next.project_id === row.project_id && next.ai_link_id === row.ai_link_id),
        ),
        ...saved,
      ]);
      if (!options.silent) toast.ok(message);
      settle();
      return saved;
    },
    [setProjectLinks, settle, t, toast],
  );

  const update = useCallback(
    async (id: string, patch: Partial<Pick<ProjectLink, "note" | "role" | "sort_order">>) => {
      let snapshot: ProjectLink[] = [];
      setProjectLinks((previous) => {
        snapshot = previous;
        return previous.map((row) => (row.id === id ? { ...row, ...patch } : row));
      });
      const { error } = await createClient()
        .from("project_links")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        setProjectLinks(snapshot);
        toast.err(t.ai.relationFailed);
        return false;
      }
      toast.ok(t.ai.relationSaved);
      settle();
      return true;
    },
    [setProjectLinks, settle, t, toast],
  );

  const remove = useCallback(
    async (ids: string[], options: { silent?: boolean } = {}) => {
      if (ids.length === 0) return true;
      let snapshot: ProjectLink[] = [];
      const removed = new Set(ids);
      setProjectLinks((previous) => {
        snapshot = previous;
        return previous.filter((row) => !removed.has(row.id));
      });
      const { error } = await createClient().from("project_links").delete().in("id", ids);
      if (error) {
        setProjectLinks(snapshot);
        toast.err(t.ai.relationFailed);
        return false;
      }
      if (!options.silent) toast.ok(t.ai.relationRemoved);
      settle();
      return true;
    },
    [setProjectLinks, settle, t, toast],
  );

  return { upsert, update, remove };
}
