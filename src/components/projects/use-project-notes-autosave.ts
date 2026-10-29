"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUnsavedDraft } from "@/components/navigation-guard";
import type { NoteEditorHandle } from "@/components/notes/note-editor";
import { saveProjectNotes, applyProjectNotesReceipt, ProjectNotesSizeError, type ProjectNotesReceipt } from "@/lib/project-notes";
import { createClient } from "@/lib/supabase/client";
import { fetchProjects } from "@/lib/queries/fetchers";
import { qk } from "@/lib/queries/keys";
import type { Project, Updater } from "@/lib/types";

/** Drafts remain in memory until a confirmed note-only receipt. The rich
 * editor marks dirty immediately and serializes on debounce or an exit flush.
 * Failed/ambiguous writes stop the queue; replacing a conflict is explicit. */
export function useProjectNotesAutosave(project: Project, setProjects: Updater<Project[]>, editor: RefObject<NoteEditorHandle | null>, available = true) {
  const qc = useQueryClient();
  const latest = useRef(project), base = useRef(project), body = useRef<string | null>(null), lastAttempt = useRef<string | null>(null);
  const revision = useRef(0), epoch = useRef(0), dirtyRef = useRef(false), chain = useRef<Promise<boolean> | null>(null);
  const queued = useRef<{ body: string; epoch: number; promise: Promise<boolean> } | null>(null);
  const replacementPending = useRef(false), reloading = useRef(false);
  const availableRef = useRef(available);
  useLayoutEffect(() => { availableRef.current = available; }, [available]);
  const conflictRef = useRef<ProjectNotesReceipt | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [failed, setFailed] = useState(false), [saved, setSaved] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [conflict, setConflict] = useState<ProjectNotesReceipt | null>(null), [generation, setGeneration] = useState(0), [seed, setSeed] = useState(project.notes);
  const capturedEpoch = generation;
  // A fresh read may confirm an ambiguous earlier attempt. Unknown external
  // note text must not silently become the base of an already dirty draft.
  useEffect(() => {
    latest.current = project;
    if (!dirtyRef.current && !chain.current) {
      if (base.current.notes !== project.notes) { setSeed(project.notes); setGeneration(++epoch.current); }
      base.current = project;
    } else if (project.notes === base.current.notes || project.notes === lastAttempt.current) base.current = project;
  }, [project]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const reconcile = () => { void qc.invalidateQueries({ queryKey: qk.projects }); };
  function markDirty() {
    if (capturedEpoch !== epoch.current) return;
    revision.current++; dirtyRef.current = true; setDirty(true); setSaved(false); setTooLarge(false);
    if (timer.current) clearTimeout(timer.current);
  }
  function discard(source?: Project) {
    if (chain.current) return;
    const current = source ?? (Date.parse(latest.current.updated_at) >= Date.parse(base.current.updated_at) ? latest.current : base.current);
    base.current = current; body.current = null; dirtyRef.current = false; conflictRef.current = null;
    setDirty(false); setFailed(false); setSaved(false); setConflict(null); setTooLarge(false); setSeed(current.notes); setGeneration(++epoch.current);
  }
  function save(text: string, replacement?: ProjectNotesReceipt): Promise<boolean> {
    if (capturedEpoch !== epoch.current) return Promise.resolve(false);
    // The previous editor debounce cannot write after the owner chose Use saved.
    if (reloading.current) { body.current = text; return Promise.resolve(false); }
    body.current = text; revision.current++; const version = revision.current, pass = epoch.current;
    dirtyRef.current = true; setDirty(true); setSaved(false);
    if (!availableRef.current) return Promise.resolve(false);
    if (conflictRef.current && !replacement && !replacementPending.current) return Promise.resolve(false);
    const previous = chain.current;
    if (queued.current?.body === text && queued.current.epoch === pass && !replacement) return queued.current.promise.then(ok => {
      // New keystrokes can be dirty before they have been serialized into body.
      if (ok && pass === epoch.current && version === revision.current && body.current === text) { dirtyRef.current = false; setDirty(false); }
      return ok;
    });
    if (!previous && !replacement && text === base.current.notes) { dirtyRef.current = false; setDirty(false); setFailed(false); return Promise.resolve(true); }
    setPending(true); setFailed(false); setTooLarge(false);
    if (replacement) replacementPending.current = true;
    const work = async () => {
      if (previous && !await previous) return false;
      if (pass !== epoch.current || !availableRef.current) return false;
      const expected = base.current; lastAttempt.current = text;
      try {
        const result = await saveProjectNotes(createClient(), expected, text, replacement);
        if (result.kind === "conflict") { conflictRef.current = result; setConflict(result); setFailed(true); reconcile(); return false; }
        await qc.cancelQueries({ queryKey: qk.projects });
        const cached = qc.getQueryData<Project[]>(qk.projects) ?? [latest.current];
        if (applyProjectNotesReceipt(cached, expected, text, result).reconcile) reconcile();
        setProjects(current => applyProjectNotesReceipt(current, expected, text, result).projects);
        base.current = { ...base.current, notes: text, updated_at: result.updated_at };
        conflictRef.current = null; setConflict(null); setFailed(false);
        if (replacement) replacementPending.current = false;
        if (pass === epoch.current && version === revision.current && body.current === text) {
          dirtyRef.current = false; setDirty(false); setFailed(false); conflictRef.current = null; setConflict(null); setSaved(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setSaved(false), 1500);
        }
        return true;
      } catch (error) { if (pass === epoch.current) { setFailed(true); setTooLarge(error instanceof ProjectNotesSizeError); } if (!(error instanceof ProjectNotesSizeError)) reconcile(); return false; }
    };
    const promise = work().finally(() => { if (chain.current === promise) { chain.current = null; queued.current = null; replacementPending.current = false; setPending(false); } });
    chain.current = promise; queued.current = { body: text, epoch: pass, promise }; return promise;
  }
  async function flush(replace = false) {
    if (capturedEpoch !== epoch.current || !availableRef.current || (conflictRef.current && !replace)) return false;
    const text = editor.current ? await editor.current.toMarkdown() : body.current;
    if (text === null || capturedEpoch !== epoch.current) return false;
    return await save(text, replace ? conflictRef.current ?? undefined : undefined) && !dirtyRef.current;
  }
  async function reloadSaved() {
    if (chain.current || reloading.current || capturedEpoch !== epoch.current || !availableRef.current) return false;
    const version = revision.current, pass = epoch.current;
    reloading.current = true; setPending(true);
    try {
      const rows = await qc.fetchQuery({ queryKey: qk.projects, queryFn: fetchProjects, staleTime: 0 });
      const source = rows.find(row => row.id === project.id && row.user_id === project.user_id);
      if (!source) throw Error("Project unavailable");
      if (pass !== epoch.current || version !== revision.current) return false;
      discard(source); return true;
    } catch { setFailed(true); return false; } finally { reloading.current = false; setPending(false); }
  }
  useUnsavedDraft({ get dirty() { return dirtyRef.current; }, pending, canSave: available && !conflict && !tooLarge, save: () => flush(), discard: () => discard() });
  return { dirty, pending, failed, saved, conflict, tooLarge, generation, seed, markDirty, save, flush, reloadSaved };
}
