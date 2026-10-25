"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGuardedNavigation, useUnsavedDraft } from "@/components/navigation-guard";
import { useToast } from "@/components/ui/toast";
import { applyProjectDetailsReceipt, projectDetailsValues, saveProjectDetails, type ProjectDetailsValues } from "@/lib/project-details";
import { safeWebUrl } from "@/lib/web-url";
import { awaitWithSignal } from "@/lib/abortable";
import { fetchProjects } from "@/lib/queries/fetchers";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { useOwnerPreferences } from "@/lib/owner-preferences";
import { qk } from "@/lib/queries/keys";
import { projectEngagement } from "@/lib/projects";
import { loadRepositoryResult } from "@/lib/github";
import { useDict } from "@/lib/i18n";
import type { Project, ProjectEngagement, Updater } from "@/lib/types";

export function projectSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type ProjectForm = {
  id?: string;
  name: string;
  slug: string;
  repo_full_name: string;
  url: string;
  dev_url: string;
  engagement: ProjectEngagement;
  organization_id: string;
};

const emptyProjectForm: ProjectForm = {
  name: "",
  slug: "",
  repo_full_name: "",
  url: "",
  dev_url: "",
  engagement: "own",
  organization_id: "",
};

function projectFormValues(form: ProjectForm, source: Project | null): ProjectDetailsValues | null {
  const url = form.url.trim() ? safeWebUrl(form.url) : null, dev_url = form.dev_url.trim() ? safeWebUrl(form.dev_url) : null;
  if ((form.url.trim() && !url) || (form.dev_url.trim() && !dev_url)) return null;
  const repo_full_name = form.repo_full_name.trim() || null;
  const repo_id = repo_full_name?.toLowerCase() === source?.repo_full_name?.toLowerCase() ? source?.repo_id ?? null : null;
  const parsed = projectDetailsValues.safeParse({ name: form.name.trim(), slug: form.slug.trim() ? projectSlug(form.slug) : automaticProjectSlug(form.name), repo_full_name, repo_id,
    url, dev_url, engagement: form.engagement, organization_id: form.organization_id || null });
  return parsed.success ? parsed.data : null;
}

export const automaticProjectSlug = (name: string) => projectSlug(name).slice(0, 100).replace(/-+$/g, "");

const sameProjectForm = (a: ProjectForm, b: ProjectForm) => (Object.keys(emptyProjectForm) as (keyof ProjectForm)[]).every(key => a[key] === b[key]);

/** The manual form owns its captured source and in-memory draft. Metadata
 * edits use confirmed receipts; the legacy creation writer remains a separate
 * idempotence/receipt follow-up. */
export function useProjectDetailsForm(projects: Project[], setProjects: Updater<Project[]>, onEditOpen: () => void) {
  const ownerScope = useOwnerPreferences();
  const supabase = createClient(), qc = useQueryClient(), t = useDict(), toast = useToast();
  const requestNavigation = useGuardedNavigation();
  const [form, setFormState] = useState<ProjectForm>(emptyProjectForm);
  const formRef = useRef({ ...emptyProjectForm }), formBase = useRef({ ...emptyProjectForm }), editSource = useRef<Project | null>(null);
  const [formOpen, setFormOpenState] = useState(false);
  const formOpenRef = useRef(false), savingRef = useRef(false);
  const session = useRef(0), writeAbort = useRef<AbortController | null>(null);
  const [reloading, setReloading] = useState(false);
  useEffect(() => () => {
    session.current++; formOpenRef.current = false; savingRef.current = false; writeAbort.current?.abort();
    editSource.current = null; formRef.current = { ...emptyProjectForm }; formBase.current = { ...emptyProjectForm };
  }, []);
  const setForm = (next: ProjectForm) => { formRef.current = { ...next }; setFormState({ ...next }); };
  const setFormOpen = (open: boolean) => {
    if (!open) { session.current++; writeAbort.current?.abort(); writeAbort.current = null; savingRef.current = false; setSaving(false); setReloading(false); }
    formOpenRef.current = open; setFormOpenState(open);
  };
  const [error, setError] = useState<string | null>(null);
  const [formConflict, setFormConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const valid = !!projectFormValues(form, null);
  const available = !form.id || projects.some(project => project.id === form.id);
  useUnsavedDraft({ get dirty() { return formOpenRef.current && !sameProjectForm(formRef.current, formBase.current); },
    get pending() { return savingRef.current; }, canSave: valid && available && !formConflict,
    save: () => saveCurrentProject(), discard: () => { setForm(formBase.current); setError(null); setFormConflict(false); } });
  function finishForm() {
    editSource.current = null; formBase.current = { ...emptyProjectForm }; setForm(emptyProjectForm); setFormOpen(false); setError(null); setFormConflict(false);
  }
  async function submitProject(e: React.FormEvent) {
    e.preventDefault();
    await saveCurrentProject();
  }

  async function saveCurrentProject(): Promise<boolean> {
    if (savingRef.current || !formOpenRef.current || formConflict) return false;
    setError(null);
    const draft = formRef.current, source = editSource.current, payload = projectFormValues(draft, source);
    if (!payload) { setError(t.projects.detailsInvalid); return false; }
    savingRef.current = true;
    setSaving(true);
    const pass = session.current, controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    writeAbort.current = controller;
    try {
      if (draft.id) {
        if (!source || source.id !== draft.id) throw Error("Project source unavailable");
        const current = qc.getQueryData<Project[]>(qk.projects);
        if (current && !current.some(project => project.id === source.id && project.user_id === source.user_id)) { setError(t.projects.detailsUnavailable); return false; }
        if (payload.repo_full_name && payload.repo_full_name.toLowerCase() !== source.repo_full_name?.toLowerCase()) {
          const result = await loadRepositoryResult(payload.repo_full_name, signal);
          if (pass !== session.current) return false;
          if (result.kind !== "ok") { setError(t.projects.detailsRepositoryUnavailable); return false; }
          payload.repo_full_name = result.repo.full_name; payload.repo_id = result.repo.id;
        }
        const receipt = await saveProjectDetails(supabase, source, payload, signal);
        if (pass !== session.current) return false;
        if (receipt.kind === "conflict") {
          setFormConflict(true); setError(t.projects.detailsConflict); void qc.invalidateQueries({ queryKey: qk.projects }); return false;
        }
        await qc.cancelQueries({ queryKey: qk.projects });
        if (pass !== session.current) return false;
        setProjects(current => applyProjectDetailsReceipt(current, source, receipt).projects);
      } else {
        const createSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
        const userId = await awaitWithSignal(currentUserId(supabase, ownerScope?.capture()), createSignal);
        if (!userId) throw new Error(t.common.signInFirst);
        const { data, error } = await awaitWithSignal(supabase
          .from("projects")
          .insert({ ...payload, user_id: userId, sort_order: projects.length })
          .select()
          .abortSignal(createSignal).single().retry(false), createSignal);
        if (pass !== session.current) return false;
        if (error) throw error;
        setProjects((prev) => [...prev, data as Project]);
      }
      finishForm();
      void qc.invalidateQueries({ queryKey: qk.projects });
      return true;
    } catch {
      if (pass === session.current) { setError(t.projects.preferenceSaveFailed); void qc.invalidateQueries({ queryKey: qk.projects }); }
      return false;
    } finally {
      if (writeAbort.current === controller) writeAbort.current = null;
      if (pass === session.current) { savingRef.current = false; setSaving(false); }
    }
  }

  function openNewProject() {
    requestNavigation(() => {
    session.current++; setReloading(false);
    editSource.current = null; formBase.current = { ...emptyProjectForm };
    setForm(emptyProjectForm);
    setError(null); setFormConflict(false);
    setFormOpen(true);
    });
  }

  function startEditProject(p: Project) {
    requestNavigation(() => {
    const project = (qc.getQueryData<Project[]>(qk.projects) ?? projects).find(row => row.id === p.id && row.user_id === p.user_id);
    if (!project) { toast.err(t.projects.detailsUnavailable); return; }
    session.current++; setReloading(false);
    editSource.current = { ...project };
    const next = {
      id: project.id, name: project.name, slug: project.slug, repo_full_name: project.repo_full_name ?? "", url: project.url ?? "", dev_url: project.dev_url ?? "",
      engagement: projectEngagement(project), organization_id: project.organization_id ?? "",
    };
    formBase.current = { ...next }; setForm(next);
    setError(null); setFormConflict(false);
    onEditOpen();
    setFormOpen(true);
    });
  }

  async function reloadProjectDetails() {
    const source = editSource.current;
    if (!source || savingRef.current || reloading || !formOpenRef.current) return;
    const pass = session.current;
    setReloading(true);
    try {
      const rows = await qc.fetchQuery({ queryKey: qk.projects, queryFn: fetchProjects, staleTime: 0 });
      if (pass !== session.current || !formOpenRef.current) return;
      const project = rows.find(row => row.id === source.id && row.user_id === source.user_id);
      if (!project) { setError(t.projects.detailsUnavailable); return; }
      startEditProject(project);
    } catch { if (pass === session.current) setError(t.common.dataUnavailable); }
    finally { if (pass === session.current) setReloading(false); }
  }

  function forgetDeleted(id: string) {
    if (formRef.current.id !== id || savingRef.current) return;
    finishForm();
  }
  return { form, setForm, formOpen, saving, reloading, error: formOpen && !available ? t.projects.detailsUnavailable : error,
    formConflict, valid: valid && available, submitProject, openNewProject, startEditProject, reloadProjectDetails, forgetDeleted,
    closeForm: () => requestNavigation(finishForm) };
}
