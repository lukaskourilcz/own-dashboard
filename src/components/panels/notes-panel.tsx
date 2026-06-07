"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { format, formatDistanceToNow } from "date-fns";
import {
  Check,
  ChevronLeft,
  Clipboard,
  Download,
  FileText,
  Hash,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import type { Note, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { NoteEditorHandle } from "@/components/notes/note-editor";

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

function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "-")
    .slice(0, 32);
}

export function NotesPanel({ notes, setNotes }: Props) {
  const supabase = createClient();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeTagFilter, setActiveTagFilter] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const lastSavedRef = useRef<Map<string, string>>(new Map());
  const editorHandleRef = useRef<NoteEditorHandle | null>(null);

  // Sort: pinned first, then most-recently-updated.
  const sorted = useMemo(() => {
    return [...notes].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return b.updated_at.localeCompare(a.updated_at);
    });
  }, [notes]);

  // Collect every distinct tag across the user's notes for the filter row.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) for (const t of n.tags ?? []) set.add(t);
    return [...set].sort();
  }, [notes]);

  // Apply title search + tag filter (intersection of all filter tags).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((n) => {
      if (q && !n.title.toLowerCase().includes(q)) return false;
      if (activeTagFilter.size > 0) {
        const has = new Set(n.tags ?? []);
        for (const t of activeTagFilter) if (!has.has(t)) return false;
      }
      return true;
    });
  }, [sorted, query, activeTagFilter]);

  const effectiveId = selectedId ?? sorted[0]?.id ?? null;
  const selected = effectiveId
    ? notes.find((n) => n.id === effectiveId) ?? null
    : null;

  async function createNote(seedContent?: unknown, seedTitle?: string) {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      toast.err("Sign in first.");
      return null;
    }
    const { data, error } = await supabase
      .from("notes")
      .insert({
        user_id: userId,
        title: seedTitle ?? "Untitled",
        content: seedContent ?? [],
        tags: [],
      })
      .select()
      .single();
    if (error || !data) {
      toast.err(error?.message ?? "Could not create note.");
      return null;
    }
    setNotes((prev) => [data as Note, ...prev]);
    setSelectedId(data.id);
    return data as Note;
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

  async function addTag(note: Note, rawTag: string) {
    const tag = normalizeTag(rawTag);
    if (!tag) return;
    if ((note.tags ?? []).includes(tag)) return;
    const nextTags = [...(note.tags ?? []), tag].sort();
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, tags: nextTags } : n)),
    );
    const { error } = await supabase
      .from("notes")
      .update({ tags: nextTags })
      .eq("id", note.id);
    if (error) {
      setNotes((prev) =>
        prev.map((n) => (n.id === note.id ? { ...n, tags: note.tags } : n)),
      );
      toast.err(error.message);
    }
  }

  async function removeTag(note: Note, tag: string) {
    const nextTags = (note.tags ?? []).filter((t) => t !== tag);
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, tags: nextTags } : n)),
    );
    const { error } = await supabase
      .from("notes")
      .update({ tags: nextTags })
      .eq("id", note.id);
    if (error) {
      setNotes((prev) =>
        prev.map((n) => (n.id === note.id ? { ...n, tags: note.tags } : n)),
      );
      toast.err(error.message);
    }
  }

  function toggleTagFilter(tag: string) {
    setActiveTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function copyAsMarkdown() {
    if (!selected || !editorHandleRef.current) return;
    try {
      const md = await editorHandleRef.current.toMarkdown();
      await navigator.clipboard.writeText(md);
      toast.ok("Copied as Markdown.");
    } catch {
      toast.err("Could not copy.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Notes"
        description="A quiet place for thoughts, prompts, and drafts."
        action={
          <div className="flex items-center gap-1.5">
            <ImportMarkdownButton
              onCreate={async (md) => {
                try {
                  const { markdownToBlocks } = await import(
                    "@/components/notes/parse-markdown"
                  );
                  const blocks = await markdownToBlocks(md);
                  // Title = first line of pasted MD, trimmed.
                  const title =
                    md
                      .split("\n")
                      .map((l) => l.replace(/^#+\s*/, "").trim())
                      .find((l) => l.length > 0)
                      ?.slice(0, 80) ?? "Imported note";
                  await createNote(blocks, title);
                  toast.ok("Imported as a new note.");
                } catch (err) {
                  toast.err((err as Error).message);
                }
              }}
            />
            <Button size="sm" onClick={() => createNote()}>
              <Plus className="h-3.5 w-3.5" />
              New note
            </Button>
          </div>
        }
      />

      {/* Tag filter row */}
      {allTags.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Hash className="h-3 w-3 text-foreground-subtle" />
          {allTags.map((t) => {
            const on = activeTagFilter.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTagFilter(t)}
                className={cn(
                  "text-[11px] font-medium rounded-full px-2 py-0.5 transition-colors",
                  on
                    ? "bg-foreground text-background"
                    : "bg-surface-muted text-foreground-muted hover:text-foreground",
                )}
              >
                {t}
              </button>
            );
          })}
          {activeTagFilter.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveTagFilter(new Set())}
              className="text-[11px] text-foreground-subtle hover:text-foreground ml-1"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* List */}
        <Card
          className={cn(
            "p-0 overflow-hidden",
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
              title={query || activeTagFilter.size > 0 ? "No matches" : "No notes yet"}
              description={
                query || activeTagFilter.size > 0
                  ? "Try a different search or tag."
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
                        {n.tags && n.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {n.tags.slice(0, 4).map((t) => (
                              <span
                                key={t}
                                className="text-[10px] text-foreground-subtle bg-surface-muted rounded px-1"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
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
                <Tooltip content="Copy as Markdown">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={copyAsMarkdown}
                    aria-label="Copy as Markdown"
                  >
                    <Clipboard className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
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

              {/* Tag strip — chips + Add tag popover */}
              <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-border">
                {(selected.tags ?? []).map((t) => (
                  <span
                    key={t}
                    className="group inline-flex items-center gap-1 text-[11px] font-medium rounded-full bg-surface-muted text-foreground-muted px-2 py-0.5"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTag(selected, t)}
                      aria-label={`Remove ${t}`}
                      className="opacity-50 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                <AddTagButton onAdd={(t) => addTag(selected, t)} />
              </div>

              <div className="flex-1 overflow-auto">
                <NoteEditor
                  key={selected.id}
                  noteId={selected.id}
                  handleRef={editorHandleRef}
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

/* ─────────────────────────────────────────────────────────────────────── */

function AddTagButton({ onAdd }: { onAdd: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    onAdd(value);
    setValue("");
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full border border-dashed border-border text-foreground-subtle hover:text-foreground hover:border-border-strong px-2 py-0.5 transition-colors focus-ring"
        >
          <Plus className="h-2.5 w-2.5" />
          Add tag
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-40 w-56 rounded-lg border border-border bg-surface p-2 shadow-elevated"
        >
          <form onSubmit={submit} className="flex gap-1.5">
            <Input
              autoFocus
              placeholder="prompt, draft, idea…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-8 text-xs"
            />
            <Button type="submit" size="sm">
              <Check className="h-3.5 w-3.5" />
            </Button>
          </form>
          <p className="text-[10px] text-foreground-subtle mt-1.5 px-1">
            Lowercase, hyphen-separated.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function ImportMarkdownButton({
  onCreate,
}: {
  onCreate: (md: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onCreate(text);
      setText("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="h-3.5 w-3.5" />
          Import MD
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-elevated">
          <Dialog.Title className="text-sm font-semibold">
            Import from Markdown
          </Dialog.Title>
          <Dialog.Description className="text-xs text-foreground-muted mt-1">
            Paste Markdown — headings, lists, code blocks. Creates a new note.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-3 space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder="# Title&#10;&#10;Your markdown here…"
              className="font-mono text-xs"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" size="sm" disabled={busy || !text.trim()}>
                <Download className="h-3.5 w-3.5" />
                {busy ? "Importing…" : "Create note"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
