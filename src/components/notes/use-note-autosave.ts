"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Note, Updater } from "@/lib/types";

export type NoteDocument = { title: string; content: unknown; plainText: string };
type Write = { noteId: string; doc: NoteDocument; version: number; serialized: string; generation: number };

/** One ordered write queue, with a retained draft and error per note. An older
 * confirmation cannot mark newer keystrokes as saved or replace metadata.
 * Drafts stay in memory; no private note content enters browser storage.
 */
export function useNoteAutosave(setNotes: Updater<Note[]>, reportFailure?: () => void) {
  const versions = useRef(new Map<string, number>());
  const activeGeneration = useRef(0);
  const [generation, setGeneration] = useState(0);
  const dirtyIds = useRef(new Set<string>());
  const documents = useRef(new Map<string, NoteDocument>());
  const confirmed = useRef(new Map<string, string>());
  const queued = useRef(new Map<string, { serialized: string; generation: number; promise: Promise<boolean> }>());
  const counts = useRef(new Map<string, number>());
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, NoteDocument>>({});
  const [errors, setErrors] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  function clearDraft(noteId: string) {
    documents.current.delete(noteId);
    dirtyIds.current.delete(noteId);
    setDirty(new Set(dirtyIds.current));
    setDrafts(current => { const next = { ...current }; delete next[noteId]; return next; });
    setErrors(current => { const next = new Set(current); next.delete(noteId); return next; });
  }
  function markDirty(noteId: string) {
    if (generation !== activeGeneration.current) return;
    versions.current.set(noteId, (versions.current.get(noteId) ?? 0) + 1);
    if (!dirtyIds.current.has(noteId)) {
      dirtyIds.current.add(noteId);
      setDirty(new Set(dirtyIds.current));
    }
  }
  const mutation = useMutation({
    scope: { id: "notes-autosave" },
    mutationFn: async ({ noteId, doc, generation: writeGeneration }: Write) => {
      if (writeGeneration !== activeGeneration.current) throw new Error("Draft discarded before write");
      const { data, error } = await createClient().from("notes").update({
        title: doc.title, content: doc.content, plain_text: doc.plainText,
      }).eq("id", noteId).select().single();
      if (error || !data || data.id !== noteId || !Array.isArray(data.content)
        || typeof data.title !== "string" || typeof data.plain_text !== "string"
        || !Number.isFinite(Date.parse(data.updated_at))) throw new Error("Note save not confirmed");
      return data as Note;
    },
    onMutate: ({ noteId }) => {
      counts.current.set(noteId, (counts.current.get(noteId) ?? 0) + 1);
      setPending(new Set(counts.current.keys()));
    },
    onSuccess: (saved, write) => {
      confirmed.current.set(write.noteId, write.serialized);
      setNotes(current => current.map(note => note.id === saved.id ? {
        ...note, title: saved.title, content: saved.content, plain_text: saved.plain_text,
        updated_at: Date.parse(saved.updated_at) > Date.parse(note.updated_at) ? saved.updated_at : note.updated_at,
      } : note));
      if (write.generation !== activeGeneration.current) {
        // A request already sent before Discard can still finish. Retain its
        // confirmed database state; never clear a subsequently edited draft.
        if (!dirtyIds.current.size) setGeneration(++activeGeneration.current);
        return;
      }
      if ((versions.current.get(write.noteId) ?? 0) === write.version
        && JSON.stringify(documents.current.get(write.noteId)) === write.serialized) clearDraft(write.noteId);
    },
    onError: (_error, { noteId, generation: writeGeneration }) => {
      if (writeGeneration !== activeGeneration.current) return;
      setErrors(current => new Set(current).add(noteId));
      reportFailure?.();
    },
    onSettled: (_data, _error, { noteId }) => {
      const count = (counts.current.get(noteId) ?? 1) - 1;
      if (count) counts.current.set(noteId, count); else counts.current.delete(noteId);
      setPending(new Set(counts.current.keys()));
    },
  });

  function save(noteId: string, doc: NoteDocument): Promise<boolean> {
    if (generation !== activeGeneration.current) return Promise.resolve(false);
    const serialized = JSON.stringify(doc);
    const version = versions.current.get(noteId) ?? 0;
    documents.current.set(noteId, doc);
    setDrafts(current => ({ ...current, [noteId]: doc }));
    if (!dirtyIds.current.has(noteId)) {
      dirtyIds.current.add(noteId);
      setDirty(new Set(dirtyIds.current));
    }
    const inFlight = queued.current.get(noteId);
    if (inFlight?.generation === generation && inFlight.serialized === serialized) return inFlight.promise.then(saved => {
      // A manual flush can capture the same text after newer keystrokes (for
      // example typing and undoing). Reuse the request but confirm this version.
      if (saved && generation === activeGeneration.current && (versions.current.get(noteId) ?? 0) === version
        && JSON.stringify(documents.current.get(noteId)) === serialized) clearDraft(noteId);
      return saved;
    });
    if (!inFlight && confirmed.current.get(noteId) === serialized) {
      clearDraft(noteId);
      return Promise.resolve(true);
    }
    const promise = mutation.mutateAsync({ noteId, doc, serialized, version, generation }).then(() => true, () => false)
      .finally(() => { if (queued.current.get(noteId)?.promise === promise) queued.current.delete(noteId); });
    queued.current.set(noteId, { serialized, promise, generation });
    return promise;
  }
  async function saveAll(current: { noteId: string; doc: NoteDocument } | null) {
    if (current && dirtyIds.current.has(current.noteId)) documents.current.set(current.noteId, current.doc);
    for (const noteId of [...dirtyIds.current]) {
      const doc = documents.current.get(noteId);
      if (!doc || !await save(noteId, doc)) return false;
    }
    return dirtyIds.current.size === 0;
  }
  function discardAll() {
    // Old editor cleanup callbacks and queued mutations retain their generation
    // and must not save after the owner's explicit discard choice.
    setGeneration(++activeGeneration.current);
    documents.current.clear(); dirtyIds.current.clear();
    setDirty(new Set()); setDrafts({}); setErrors(new Set());
  }
  return { dirty, drafts, errors, pending, generation, markDirty, save, saveAll, clearDraft, discardAll };
}
