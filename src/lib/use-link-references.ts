"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import type { AiLinkProject, Updater } from "@/lib/types";

/**
 * The one place a link-to-project reference is written from the browser.
 *
 * The library card and the project workspace both connect and disconnect
 * references, so the mutation lives here rather than in either panel. Writes
 * are optimistic for removal and status changes and non-optimistic for
 * inserts, because the row id comes from the database.
 */
export function useLinkReferences(references: AiLinkProject[], setReferences: Updater<AiLinkProject[]>) {
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useDict();
  const invalidate = useCallback(() => { void qc.invalidateQueries({ queryKey: qk.aiLinkProjects }); }, [qc]);

  const connect = useCallback(async (linkId: string, projectId: string, status: AiLinkProject["status"]) => {
    if (references.some((reference) => reference.link_id === linkId && reference.project_id === projectId)) return;
    const userId = await currentUserId(supabase);
    if (!userId) { toast.err(t.ai.signInFirst); return; }
    const { data, error } = await supabase
      .from("ai_link_projects")
      .insert({ user_id: userId, link_id: linkId, project_id: projectId, status })
      .select()
      .single();
    if (error || !data) { toast.err(t.ai.couldNotConnect); return; }
    setReferences((previous) => [...previous, data as AiLinkProject]);
    toast.ok(t.ai.connectionAdded);
    invalidate();
  }, [references, setReferences, supabase, toast, t, invalidate]);

  const disconnect = useCallback(async (id: string) => {
    const previous = references;
    setReferences((current) => current.filter((reference) => reference.id !== id));
    const { error } = await supabase.from("ai_link_projects").delete().eq("id", id);
    if (error) { setReferences(previous); toast.err(t.ai.couldNotConnect); return; }
    toast.ok(t.ai.connectionRemoved);
    invalidate();
  }, [references, setReferences, supabase, toast, t, invalidate]);

  const setStatus = useCallback(async (id: string, status: AiLinkProject["status"]) => {
    const previous = references;
    setReferences((current) => current.map((reference) => reference.id === id ? { ...reference, status } : reference));
    const { error } = await supabase
      .from("ai_link_projects")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { setReferences(previous); toast.err(t.ai.couldNotConnect); return; }
    invalidate();
  }, [references, setReferences, supabase, toast, t, invalidate]);

  return { connect, disconnect, setStatus };
}
