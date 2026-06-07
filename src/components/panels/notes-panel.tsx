"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { format, formatDistanceToNow } from "date-fns";
import {
  ChevronLeft,
  FileText,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import type { Note, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";

// BlockNote pulls in ProseMirror + Mantine CSS — it's heavy. Lazy-load so it
// doesn't bloat the dashboard's first paint, and only on the client because
// the editor manipulates DOM directly.
const NoteEditor = dynamic(
  () => import("@/components/notes/note-editor").then((m) => m.NoteEditor),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 text-xs text-foreground-subtle">Loading editor…</div>
    ),
  },
);

type Props = {
  notes: Note[];
  setNotes: Updater<Note[]>;
};

export function NotesPanel({ notes, setNotes }: Props) {
  const supabase = createClient();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const lastSavedRef = useRef<Map<string, string>>(new Map());

  // Sort: pinned first, then most-recently-updated.
  const sorted = useMemo(() => {
    return [...notes].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return b.updated_at.localeCompare(a.updated_at);
    });
  }, [notes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((n) => n.title.toLowerCase().includes(q));
  }, [sorted, query]);

  // Auto-select the first note when none is selected and there are some.
  // Done as a derived value (not effect) by computing it inline.
  const effectiveId = selectedId ?? sorted[0]?.id ?? null;
  const selected = effectiveId
    ? notes.find((n) => n.id === effectiveId) ?? null
    : null;

  async function createNote() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      toast.err("Sign in first.");
      return;
    }
    const { data, error } = await supabase
      .from("notes")
      .insert({ user_id: userId, title: "Untitled", content: [] })
      .select()
      .single();
    if (error || !data) {
      toast.err(error?.message ?? "Could not create note.");
      return;
    }
    setNotes((prev) => [data as Note, ...prev]);
    setSelectedId(data.id);
  }

  async function deleteNote(id: string) {
    const ok = window.confirm("Delete this note? This cannot be undone.");
    if (!ok) return;
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (selectedId === id) setSelectedId(null);
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (error) toast.err(error.message);
  }

  async function togglePin(note: Note) {
    const next = !note.is_pinned;
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, is_pinned: next } : n)),
    );
    const { error } = await supabase
      .from("notes")
      .update({ is_pinned: next })
      .eq("id", note.id);
    if (error) {
      setNotes((prev) =>
        prev.map((n) => (n.id === note.id ? { ...n, is_pinned: !next } : n)),
      );
      toast.err(error.message);
    }
  }

  async function saveDoc(
    noteId: string,
    doc: { title: string; content: unknown },
  ) {
    // Skip writes that don't actually change anything — cheaply dedupe by
    // serialising the document and comparing to the last persisted hash.
    const serialized = JSON.stringify(doc);
    if (lastSavedRef.current.get(noteId) === serialized) return;
    lastSavedRef.current.set(noteId, serialized);

    setSavingId(noteId);
    const { data, error } = await supabase
      .from("notes")
      .update({ title: doc.title || "Untitled", content: doc.content })
      .eq("id", noteId)
      .select()
      .single();
    setSavingId((s) => (s === noteId ? null : s));
    if (error || !data) {
      toast.err(error?.message ?? "Could not save note.");
      return;
    }
    setNotes((prev) => prev.map((n) => (n.id === noteId ? (data as Note) : n)));
  }

  return (
    <div>
      <PageHeader
        title="Notes"
        description="A quiet place for thoughts, prompts, and drafts."
        action={
          <Button size="sm" onClick={createNote}>
            <Plus className="h-3.5 w-3.5" />
            New note
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* List */}
        <Card
          className={cn(
            "p-0 overflow-hidden",
            // On mobile, hide the list when a note is selected (modal-like).
            selected && "hidden lg:block",
          )}
        >
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-foreground-subtle" />
              <Input
                placeholder="Search notes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={query ? "No matches" : "No notes yet"}
              description={
                query
                  ? "Try a different search."
                  : "Click New note to start writing."
              }
              className="py-10"
            />
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto p-1.5">
              <AnimatePresence initial={false}>
                {filtered.map((n) => {
                  const isActive = n.id === effectiveId;
                  return (
                    <motion.li
                      key={n.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.12 }}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(n.id)}
                        className={cn(
                          "w-full text-left rounded-md px-2.5 py-2 transition-colors",
                          isActive
                            ? "bg-accent text-foreground"
                            : "hover:bg-surface-hover text-foreground-muted hover:text-foreground",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {n.is_pinned && (
                            <Pin className="h-3 w-3 text-warning shrink-0" />
                          )}
                          <span className="text-sm font-medium truncate">
                            {n.title || "Untitled"}
                          </span>
                        </div>
                        <p className="text-[10px] text-foreground-subtle tabular mt-0.5">
                          {formatDistanceToNow(new Date(n.updated_at), {
                            addSuffix: true,
                          })}
                        </p>
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </Card>

        {/* Editor */}
        <Card
          className={cn(
            "min-h-[60vh] p-0 overflow-hidden",
            !selected && "hidden lg:flex",
          )}
        >
          {selected ? (
            <div className="flex flex-col w-full">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="lg:hidden inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors focus-ring"
                  aria-label="Back"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">
                    {selected.title || "Untitled"}
                  </p>
                  <p className="text-[10px] text-foreground-subtle tabular">
                    {savingId === selected.id
                      ? "Saving…"
                      : `Saved ${format(new Date(selected.updated_at), "HH:mm")}`}
                  </p>
                </div>
                <Tooltip content={selected.is_pinned ? "Unpin" : "Pin"}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => togglePin(selected)}
                    aria-label="Pin"
                  >
                    {selected.is_pinned ? (
                      <PinOff className="h-3.5 w-3.5" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </Tooltip>
                <Tooltip content="Delete">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => deleteNote(selected.id)}
                    aria-label="Delete note"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </Tooltip>
              </div>

              <div className="flex-1 overflow-auto">
                <NoteEditor
                  key={selected.id}
                  noteId={selected.id}
                  // The row stores BlockNote's Block[] JSON; cast back at the
                  // edge since `Note.content` is intentionally typed as
                  // `unknown` (only the editor reads its shape).
                  initialContent={
                    (Array.isArray(selected.content)
                      ? selected.content
                      : []) as never
                  }
                  onChange={(doc) => saveDoc(selected.id, doc)}
                />
              </div>
            </div>
          ) : (
            <EmptyState
              icon={FileText}
              title="Select a note"
              description="Or create a new one to start writing."
              className="py-20"
            />
          )}
        </Card>
      </div>
    </div>
  );
}
