"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUnsavedDraft } from "@/components/navigation-guard";
import { applyProjectPreferencesReceipt, setProjectPreferences, type ProjectPreferencesPatch } from "@/lib/project-preferences";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
import type { Project, Updater } from "@/lib/types";

export function useProjectPreferencesSave(setProjects: Updater<Project[]>) {
  const qc = useQueryClient(), inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  useUnsavedDraft({ dirty: false, get pending() { return inFlight.current.size > 0; }, canSave: false, save: async () => false });
  async function save(project: Project, patch: ProjectPreferencesPatch): Promise<"saved" | "conflict" | "failed" | "busy"> {
    if (inFlight.current.has(project.id)) return "busy";
    inFlight.current.add(project.id); setPending(new Set(inFlight.current));
    try {
      const receipt = await setProjectPreferences(createClient(), project, patch);
      if (receipt.kind === "conflict") { await qc.invalidateQueries({ queryKey: qk.projects }); return "conflict"; }
      await qc.cancelQueries({ queryKey: qk.projects });
      const cached = qc.getQueryData<Project[]>(qk.projects) ?? [];
      const { reconcile } = applyProjectPreferencesReceipt(cached, receipt);
      setProjects(current => applyProjectPreferencesReceipt(current, receipt).projects);
      if (reconcile) await qc.invalidateQueries({ queryKey: qk.projects });
      return "saved";
    } catch {
      // A lost acknowledgement can still mean committed data. Read the source;
      // never roll an older snapshot over a newer local/server change.
      await qc.invalidateQueries({ queryKey: qk.projects }); return "failed";
    } finally { inFlight.current.delete(project.id); setPending(new Set(inFlight.current)); }
  }
  return { save, pending };
}
