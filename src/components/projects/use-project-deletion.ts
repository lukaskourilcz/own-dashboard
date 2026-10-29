"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGuardedNavigation, useUnsavedDraft } from "@/components/navigation-guard";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { awaitWithSignal } from "@/lib/abortable";
import { deleteOwnedProject, ProjectDeleteConflict } from "@/lib/project-deletion";
import { sameProjectSnapshot } from "@/lib/projects";
import { createClient } from "@/lib/supabase/client";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import type { Project } from "@/lib/types";

export function useProjectDeletion(onDeleted: (source: Project) => void) {
  const qc = useQueryClient(), confirm = useConfirmation(), navigate = useGuardedNavigation(), t = useDict();
  const operation = useRef<AbortController | null>(null), mounted = useRef(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
  useUnsavedDraft({ dirty: false, get pending() { return operation.current !== null; }, canSave: false, save: async () => false });
  async function remove(source: Project) {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setPendingId(source.id); setFailure(null);
    let attempted = false, confirmed = false;
    try {
      if (!await awaitWithSignal(confirm({ title: t.projects.deleteProject, description: t.projects.deleteProjectConfirm,
        confirmLabel: t.common.delete, cancelLabel: t.common.cancel, destructive: true }), controller.signal)) return;
      if (!mounted.current) return;
      confirmed = true;
      const current = qc.getQueryData<Project[]>(qk.projects)?.find(row => row.id === source.id && row.user_id === source.user_id);
      if (!current || !sameProjectSnapshot(current, source)) throw new ProjectDeleteConflict();
      attempted = true;
      await deleteOwnedProject(createClient(), source, controller.signal);
      await qc.cancelQueries({ queryKey: qk.projects });
      if (!mounted.current) return;
      onDeleted(source);
    } catch (error) {
      if (mounted.current) setFailure({ id: source.id, message: error instanceof ProjectDeleteConflict ? t.projects.deleteConflict : t.projects.deleteFailed });
    } finally {
      if (operation.current === controller) operation.current = null;
      if (mounted.current) setPendingId(null);
      // A lost reply can mean the deletion committed. Reconcile every related
      // destination even on failure; never assume that it rolled back.
      if (confirmed) void qc.invalidateQueries({ queryKey: qk.projects });
      if (attempted) for (const queryKey of [qk.projectLinks, qk.todos, qk.notes, qk.invoices, qk.transactions, qk.opportunities,
        qk.importantDates, qk.projectCommunications, qk.projectCosts, qk.crons, qk.subscriptionAllocations, qk.competitors, qk.subscriptions]) void qc.invalidateQueries({ queryKey });
    }
  }
  return { pendingId, failure, remove: (source: Project) => {
    // Refuse a duplicate before asking the navigation guard. Otherwise the
    // guard can queue it as an exit and replay it after the first delete.
    if (operation.current) return;
    navigate(() => { void remove({ ...source }); });
  } };
}
