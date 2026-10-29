"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveRepositoryNote } from "@/lib/repository-records";
import { useUnsavedDraft } from "@/components/navigation-guard";
import type { RepoNote, Updater } from "@/lib/types";

/** Ordered, versioned saves; draft text never becomes confirmed cache data.
 * Keep drafts above filtered cards, so search cannot discard an unsaved edit. */
export function useRepositoryNoteAutosave(setNotes: Updater<RepoNote[]>, reportFailure: () => void, reconcile: () => void) {
  const documents = useRef(new Map<string, string>()), bases = useRef(new Map<string, RepoNote>());
  const revisions = useRef(new Map<string, number>()), timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chains = useRef(new Map<string, Promise<boolean>>()), failed = useRef(new Set<string>()), epoch = useRef(0);
  const queuedBodies = useRef(new Map<string, { body: string; epoch: number }>());
  const [drafts, setDrafts] = useState<Record<string, string>>({}), [errors, setErrors] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [generation, setGeneration] = useState(0);

  function clearTimer(id: string) { const timer = timers.current.get(id); if (timer) clearTimeout(timer); timers.current.delete(id); }
  function clearDraft(id: string) {
    clearTimer(id); documents.current.delete(id); failed.current.delete(id);
    setDrafts(current => { const next = { ...current }; delete next[id]; return next; });
    setErrors(new Set(failed.current));
  }
  function save(id: string): Promise<boolean> {
    clearTimer(id);
    const body = documents.current.get(id), revision = revisions.current.get(id), capturedEpoch = epoch.current;
    if (body === undefined) return chains.current.get(id) ?? Promise.resolve(true);
    const previous = chains.current.get(id);
    const queued = queuedBodies.current.get(id);
    if (previous && queued?.body === body && queued.epoch === capturedEpoch) return previous.then(saved => {
      if (saved && epoch.current === capturedEpoch && documents.current.get(id) === body) clearDraft(id);
      return saved;
    });
    const work = async () => {
      if (previous && !await previous) return false;
      if (capturedEpoch !== epoch.current) return false;
      const base = bases.current.get(id); if (!base) return false;
      setPending(current => new Set(current).add(id));
      try {
        const saved = await saveRepositoryNote(createClient(), base, body);
        bases.current.set(id, saved);
        setNotes(current => current.map(note => note.id === id ? saved : note));
        if (capturedEpoch === epoch.current && revision === revisions.current.get(id) && documents.current.get(id) === body) clearDraft(id);
        return true;
      } catch {
        if (capturedEpoch === epoch.current) { failed.current.add(id); setErrors(new Set(failed.current)); reportFailure(); }
        reconcile(); return false;
      }
    };
    const promise = work().finally(() => {
      if (chains.current.get(id) === promise) { chains.current.delete(id); queuedBodies.current.delete(id); setPending(current => { const next = new Set(current); next.delete(id); return next; }); }
    });
    chains.current.set(id, promise); queuedBodies.current.set(id, { body, epoch: capturedEpoch }); return promise;
  }
  function change(note: RepoNote, body: string) {
    if (!documents.current.has(note.id)) bases.current.set(note.id, note);
    revisions.current.set(note.id, (revisions.current.get(note.id) ?? 0) + 1);
    documents.current.set(note.id, body); setDrafts(current => ({ ...current, [note.id]: body })); clearTimer(note.id);
    timers.current.set(note.id, setTimeout(() => { timers.current.delete(note.id); void save(note.id); }, 700));
  }
  async function saveAll() {
    for (const id of new Set([...documents.current.keys(), ...chains.current.keys()])) if (!await save(id)) return false;
    return documents.current.size === 0 && chains.current.size === 0;
  }
  function discardAll() {
    epoch.current++; setGeneration(epoch.current);
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear(); documents.current.clear(); failed.current.clear(); setDrafts({}); setErrors(new Set());
  }
  useUnsavedDraft({ pending: pending.size > 0, dirty: Object.keys(drafts).length > 0 || pending.size > 0, canSave: true, save: saveAll, discard: discardAll });
  useEffect(() => { const active = timers.current; return () => { for (const timer of active.values()) clearTimeout(timer); active.clear(); }; }, []);
  function discard(id: string) { if (chains.current.has(id)) return false; clearDraft(id); return true; }
  return { drafts, errors, pending, generation, change, save: async (id: string) => await save(id) && !documents.current.has(id), saveAll, discard, discardAll };
}
