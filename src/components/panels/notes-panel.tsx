"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogTrigger,
} from "@/components/ui/dialog";
import * as Popover from "@radix-ui/react-popover";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { format, formatDistanceToNow } from "date-fns";
import {
  Bot,
  Check,
  ChevronLeft,
  Clipboard,
  Download,
  FileText,
  GripVertical,
  Hash,
  Link2,
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
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { qk } from "@/lib/queries/keys";
import { useDict, useDateLocale } from "@/lib/i18n";
import type { Note, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";
import { tagColor } from "@/lib/tag-colors";
import type { NoteEditorHandle } from "@/components/notes/note-editor";
import { GithubIcon } from "@/components/icons/github";
import { PublishToRepoDialog } from "@/components/github/publish-to-repo-dialog";

// BlockNote pulls in ProseMirror + Mantine CSS — it's heavy. Lazy-load so it
// doesn't bloat the dashboard's first paint, and only on the client because
// the editor manipulates DOM directly.
function EditorLoading() {
  const t = useDict();
  return (
    <div className="p-6 text-xs text-foreground-subtle">
      {t.notes.loadingEditor}
    </div>
  );
}

const NoteEditor = dynamic(
  () => import("@/components/notes/note-editor").then((m) => m.NoteEditor),
  {
    ssr: false,
    loading: () => <EditorLoading />,
  },
);

function noteDate(note: Pick<Note, "updated_at" | "created_at">): Date {
  const updated = new Date(note.updated_at);
  if (!Number.isNaN(updated.getTime())) return updated;
  const created = new Date(note.created_at);
  return Number.isNaN(created.getTime()) ? new Date(0) : created;
}

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

function downloadBlob(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer the revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

function safeFilename(title: string): string {
  return (title || "note")
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

export function NotesPanel({ notes, setNotes }: Props) {
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useDict();
  const locale = useDateLocale();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeTagFilter, setActiveTagFilter] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkPickerQuery, setLinkPickerQuery] = useState("");
  const lastSavedRef = useRef<Map<string, string>>(new Map());
  const editorHandleRef = useRef<NoteEditorHandle | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState(false);
  const [knowledgeReview, setKnowledgeReview] = useState<{
    summary: string;
    proposals: { kind: string; title: string; reason: string; sourceIds: string[] }[];
  } | null>(null);

  async function reviewKnowledge() {
    if (!window.confirm(t.notes.knowledgeConsent)) return;
    setKnowledgeOpen(true);
    setKnowledgeBusy(true);
    setKnowledgeError(false);
    setKnowledgeReview(null);
    try {
      const response = await fetch("/api/ai/knowledge-review", { method: "POST" });
      if (response.status === 403) {
        toast.err(t.notes.knowledgeNeedsSensitive);
        setKnowledgeOpen(false);
        return;
      }
      const data = await response.json().catch(() => null) as { review?: typeof knowledgeReview } | null;
      if (!response.ok || !data?.review) throw new Error("unavailable");
      setKnowledgeReview(data.review);
    } catch {
      setKnowledgeError(true);
    } finally {
      setKnowledgeBusy(false);
    }
  }

  // Pinned bucket first (drag-orderable), then everything else by sort_order
  // desc. sort_order was backfilled from updated_at, so first render matches
  // the previous "most recently edited" feel.
  const { pinned, unpinned } = useMemo(() => {
    const sorted = [...notes].sort(
      (a, b) => (b.sort_order ?? 0) - (a.sort_order ?? 0),
    );
    return {
      pinned: sorted.filter((n) => n.is_pinned),
      unpinned: sorted.filter((n) => !n.is_pinned),
    };
  }, [notes]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) for (const tag of n.tags ?? []) set.add(tag);
    return [...set].sort();
  }, [notes]);

  // Filter both buckets — title match OR plain_text substring, plus tag
  // intersection. plain_text is populated on every save (see editor).
  const filterPredicate = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (n: Note) => {
      if (q) {
        const hay = `${n.title}\n${n.plain_text ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (activeTagFilter.size > 0) {
        const has = new Set(n.tags ?? []);
        for (const tag of activeTagFilter) if (!has.has(tag)) return false;
      }
      return true;
    };
  }, [query, activeTagFilter]);

  const pinnedFiltered = useMemo(
    () => pinned.filter(filterPredicate),
    [pinned, filterPredicate],
  );
  const unpinnedFiltered = useMemo(
    () => unpinned.filter(filterPredicate),
    [unpinned, filterPredicate],
  );
  const visibleCount = pinnedFiltered.length + unpinnedFiltered.length;

  const effectiveId =
    selectedId ?? pinned[0]?.id ?? unpinned[0]?.id ?? null;
  const selected = effectiveId
    ? notes.find((n) => n.id === effectiveId) ?? null
    : null;

  // CREATE — non-optimistic. The insert returns the row; we prepend it and
  // select it in onSuccess, then invalidate to reconcile with the server.
  const createMutation = useMutation({
    mutationFn: async (vars: { content: unknown; title: string }) => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      // Place new notes above every existing one in their bucket.
      const topSortOrder = Math.max(0, ...notes.map((n) => n.sort_order ?? 0));
      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: userId,
          title: vars.title,
          content: vars.content,
          tags: [],
          sort_order: topSortOrder + 1,
        })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as Note;
    },
    onSuccess: (note) => {
      setNotes((prev) => [note, ...prev]);
      setSelectedId(note.id);
      void qc.invalidateQueries({ queryKey: qk.notes });
    },
  });

  async function createNote(seedContent?: unknown, seedTitle?: string) {
    try {
      return await createMutation.mutateAsync({
        content: seedContent ?? [],
        title: seedTitle ?? t.notes.untitled,
      });
    } catch (err) {
      if ((err as Error)?.message === "no-user") {
        toast.err(t.notes.signInFirst);
      } else {
        toast.err((err as Error)?.message ?? t.notes.couldNotCreateNote);
      }
      return null;
    }
  }

  // DELETE — optimistic (row removed before the await in the original).
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notes").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.notes });
      const prev = qc.getQueryData<Note[]>(qk.notes);
      setNotes((old) => old.filter((n) => n.id !== id));
      if (selectedId === id) setSelectedId(null);
      return { prev };
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) setNotes(ctx.prev);
      toast.err((e as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notes }),
  });

  async function deleteNote(id: string) {
    const ok = window.confirm(t.notes.deleteConfirm);
    if (!ok) return;
    deleteMutation.mutate(id);
  }

  // TOGGLE PIN — optimistic.
  const togglePinMutation = useMutation({
    mutationFn: async (vars: { id: string; next: boolean }) => {
      const { error } = await supabase
        .from("notes")
        .update({ is_pinned: vars.next })
        .eq("id", vars.id);
      if (error) throw error;
    },
    onMutate: async ({ id, next }) => {
      await qc.cancelQueries({ queryKey: qk.notes });
      const prev = qc.getQueryData<Note[]>(qk.notes);
      setNotes((old) =>
        old.map((n) => (n.id === id ? { ...n, is_pinned: next } : n)),
      );
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) setNotes(ctx.prev);
      toast.err((e as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notes }),
  });

  function togglePin(note: Note) {
    togglePinMutation.mutate({ id: note.id, next: !note.is_pinned });
  }

  // AUTOSAVE — optimistic update of the returned row. savingId is set in
  // onMutate and cleared in onSettled to drive the "saving…" indicator,
  // mirroring the original set-before-await / clear-after-await behaviour.
  const saveMutation = useMutation({
    mutationFn: async (vars: {
      noteId: string;
      doc: { title: string; content: unknown; plainText: string };
    }) => {
      const { data, error } = await supabase
        .from("notes")
        .update({
          title: vars.doc.title || t.notes.untitled,
          content: vars.doc.content,
          plain_text: vars.doc.plainText,
        })
        .eq("id", vars.noteId)
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as Note;
    },
    onMutate: ({ noteId }) => {
      setSavingId(noteId);
    },
    onSuccess: (data, { noteId }) => {
      setNotes((prev) => prev.map((n) => (n.id === noteId ? data : n)));
    },
    onError: (e) => {
      toast.err((e as Error)?.message ?? t.notes.couldNotSaveNote);
    },
    onSettled: (_data, _e, { noteId }) => {
      setSavingId((s) => (s === noteId ? null : s));
    },
  });

  async function saveDoc(
    noteId: string,
    doc: { title: string; content: unknown; plainText: string },
  ) {
    const serialized = JSON.stringify(doc);
    if (lastSavedRef.current.get(noteId) === serialized) return;
    lastSavedRef.current.set(noteId, serialized);

    saveMutation.mutate({ noteId, doc });
  }

  // TAGS — optimistic. add/remove share one mutation; the handlers compute the
  // next tags array and roll back to the note's prior tags on error.
  const tagsMutation = useMutation({
    mutationFn: async (vars: { id: string; tags: string[] }) => {
      const { error } = await supabase
        .from("notes")
        .update({ tags: vars.tags })
        .eq("id", vars.id);
      if (error) throw error;
    },
    onMutate: async ({ id, tags }) => {
      await qc.cancelQueries({ queryKey: qk.notes });
      const prev = qc.getQueryData<Note[]>(qk.notes);
      setNotes((old) =>
        old.map((n) => (n.id === id ? { ...n, tags } : n)),
      );
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) setNotes(ctx.prev);
      toast.err((e as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notes }),
  });

  function addTag(note: Note, rawTag: string) {
    const tag = normalizeTag(rawTag);
    if (!tag) return;
    if ((note.tags ?? []).includes(tag)) return;
    const nextTags = [...(note.tags ?? []), tag].sort();
    tagsMutation.mutate({ id: note.id, tags: nextTags });
  }

  function removeTag(note: Note, tag: string) {
    const nextTags = (note.tags ?? []).filter((x) => x !== tag);
    tagsMutation.mutate({ id: note.id, tags: nextTags });
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
      toast.ok(t.notes.copiedAsMarkdown);
    } catch {
      toast.err(t.notes.couldNotCopy);
    }
  }

  async function downloadAsMarkdown() {
    if (!selected || !editorHandleRef.current) return;
    try {
      const md = await editorHandleRef.current.toMarkdown();
      downloadBlob(`${safeFilename(selected.title)}.md`, md, "text/markdown");
    } catch {
      toast.err(t.notes.couldNotExport);
    }
  }

  // dnd-kit setup — pointer for mouse, keyboard for accessibility.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // REORDER — optimistic. The fractional sort_order is computed in the drag
  // handler; only its persistence lives here. prevOrder is the moved item's
  // order before the drag, used to roll back on error.
  const reorderMutation = useMutation({
    mutationFn: async (vars: {
      id: string;
      nextOrder: number;
      prevOrder: number;
    }) => {
      const { error } = await supabase
        .from("notes")
        .update({ sort_order: vars.nextOrder })
        .eq("id", vars.id);
      if (error) throw error;
    },
    onMutate: async ({ id, nextOrder }) => {
      await qc.cancelQueries({ queryKey: qk.notes });
      const prev = qc.getQueryData<Note[]>(qk.notes);
      setNotes((old) =>
        old.map((n) => (n.id === id ? { ...n, sort_order: nextOrder } : n)),
      );
      return { prev };
    },
    onError: (e, vars, ctx) => {
      if (ctx?.prev) {
        setNotes(ctx.prev);
      } else {
        setNotes((prev) =>
          prev.map((n) =>
            n.id === vars.id ? { ...n, sort_order: vars.prevOrder } : n,
          ),
        );
      }
      toast.err((e as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notes }),
  });

  function handlePinnedDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIndex = pinned.findIndex((n) => n.id === e.active.id);
    const newIndex = pinned.findIndex((n) => n.id === e.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(pinned, oldIndex, newIndex);
    // Compute a single new sort_order for the moved item — fractional indexing
    // between its new neighbors, avoiding a batch resequence.
    const above = newIndex > 0 ? reordered[newIndex - 1] : null;
    const below = newIndex < reordered.length - 1 ? reordered[newIndex + 1] : null;
    const moved = reordered[newIndex];
    let nextOrder: number;
    if (above && below) {
      nextOrder = (above.sort_order + below.sort_order) / 2;
    } else if (above) {
      nextOrder = above.sort_order - 1;
    } else if (below) {
      nextOrder = below.sort_order + 1;
    } else {
      return;
    }

    reorderMutation.mutate({
      id: moved.id,
      nextOrder,
      prevOrder: moved.sort_order,
    });
  }

  return (
    <div>
      <PageHeader
        title={t.notes.title}
        description={t.notes.description}
        action={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={reviewKnowledge} disabled={knowledgeBusy}>
              <Bot className="h-3.5 w-3.5" />
              {knowledgeBusy ? t.notes.knowledgeReviewing : t.notes.knowledgeReview}
            </Button>
            <ImportMarkdownButton
              onCreate={async (md) => {
                try {
                  const { markdownToBlocks } = await import(
                    "@/components/notes/parse-markdown"
                  );
                  const blocks = await markdownToBlocks(md);
                  const title =
                    md
                      .split("\n")
                      .map((l) => l.replace(/^#+\s*/, "").trim())
                      .find((l) => l.length > 0)
                      ?.slice(0, 80) ?? t.notes.importedNote;
                  await createNote(blocks, title);
                  toast.ok(t.notes.importedAsNewNote);
                } catch (err) {
                  toast.err((err as Error).message);
                }
              }}
            />
            <Button size="sm" onClick={() => createNote()}>
              <Plus className="h-3.5 w-3.5" />
              {t.notes.newNote}
            </Button>
          </div>
        }
      />

      {/* Tag filter row */}
      {allTags.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Hash className="h-3 w-3 text-foreground-subtle" />
          {allTags.map((tag) => {
            const on = activeTagFilter.has(tag);
            const c = tagColor(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTagFilter(tag)}
                className={cn(
                  "text-[11px] font-medium rounded-full px-2 py-0.5 transition-colors border",
                  on
                    ? "bg-foreground text-background border-foreground"
                    : "hover:opacity-90",
                )}
                style={
                  on
                    ? undefined
                    : { background: c.bg, color: c.text, borderColor: c.border }
                }
              >
                {tag}
              </button>
            );
          })}
          {activeTagFilter.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveTagFilter(new Set())}
              className="text-[11px] text-foreground-subtle hover:text-foreground ml-1"
            >
              {t.notes.clear}
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
                placeholder={t.notes.searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
          </div>

          {visibleCount === 0 ? (
            <EmptyState
              icon={FileText}
              title={
                query || activeTagFilter.size > 0
                  ? t.notes.noMatches
                  : t.notes.noNotesYet
              }
              description={
                query || activeTagFilter.size > 0
                  ? t.notes.noMatchesDescription
                  : t.notes.noNotesDescription
              }
              className="py-10"
            />
          ) : (
            <div className="max-h-[60vh] overflow-y-auto p-1.5">
              {pinnedFiltered.length > 0 && (
                <>
                  <SectionLabel className="px-2 pt-1 pb-1">
                    {t.notes.pinned}
                  </SectionLabel>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handlePinnedDragEnd}
                  >
                    <SortableContext
                      items={pinnedFiltered.map((n) => n.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul>
                        {pinnedFiltered.map((n) => (
                          <SortableNoteRow
                            key={n.id}
                            note={n}
                            isActive={n.id === effectiveId}
                            onSelect={() => setSelectedId(n.id)}
                          />
                        ))}
                      </ul>
                    </SortableContext>
                  </DndContext>
                  {unpinnedFiltered.length > 0 && (
                    <SectionLabel className="px-2 pt-3 pb-1">
                      {t.notes.notes}
                    </SectionLabel>
                  )}
                </>
              )}
              <ul>
                <AnimatePresence initial={false}>
                  {unpinnedFiltered.map((n) => (
                    <NoteRow
                      key={n.id}
                      note={n}
                      isActive={n.id === effectiveId}
                      onSelect={() => setSelectedId(n.id)}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </div>
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
                  aria-label={t.notes.back}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">
                    {selected.title || t.notes.untitled}
                  </p>
                  <p className="text-[10px] text-foreground-muted tabular">
                    {savingId === selected.id
                      ? t.notes.saving
                      : t.notes.savedAt(
                          format(
                            noteDate(selected),
                            t.notes.savedTimeFormat,
                            { locale },
                          ),
                        )}
                  </p>
                </div>
                <Tooltip content={t.notes.copyAsMarkdown}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={copyAsMarkdown}
                    aria-label={t.notes.copyAsMarkdown}
                  >
                    <Clipboard className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content={t.notes.downloadMd}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={downloadAsMarkdown}
                    aria-label={t.notes.downloadAsMarkdown}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content={t.github.publish}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setPublishOpen(true)}
                    aria-label={t.github.publish}
                  >
                    <GithubIcon className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content={selected.is_pinned ? t.notes.unpin : t.notes.pin}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => togglePin(selected)}
                    aria-label={t.notes.pin}
                  >
                    {selected.is_pinned ? (
                      <PinOff className="h-3.5 w-3.5" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </Tooltip>
                <Tooltip content={t.notes.delete}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => deleteNote(selected.id)}
                    aria-label={t.notes.deleteNote}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </Tooltip>
              </div>

              {/* Tag strip — chips + Add tag popover */}
              <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-border">
                {(selected.tags ?? []).map((tag) => {
                  const c = tagColor(tag);
                  return (
                    <span
                      key={tag}
                      className="group inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border"
                      style={{
                        background: c.bg,
                        color: c.text,
                        borderColor: c.border,
                      }}
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(selected, tag)}
                        aria-label={t.notes.removeTag(tag)}
                        className="opacity-50 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  );
                })}
                <AddTagButton onAdd={(tag) => addTag(selected, tag)} />
              </div>

              <div className="flex-1 overflow-auto">
                <NoteEditor
                  key={selected.id}
                  noteId={selected.id}
                  handleRef={editorHandleRef}
                  onRequestNoteLink={() => {
                    setLinkPickerQuery("");
                    setLinkPickerOpen(true);
                  }}
                  onNavigateToNote={(id) => setSelectedId(id)}
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
              title={t.notes.selectANote}
              description={t.notes.selectANoteDescription}
              className="py-20"
            />
          )}
        </Card>
      </div>

      {publishOpen && selected && (
        <PublishToRepoDialog
          getMarkdown={() =>
            editorHandleRef.current?.toMarkdown() ?? Promise.resolve("")
          }
          defaultFileName={safeFilename(selected.title || t.notes.untitled)}
          defaultMessage={t.github.messagePlaceholder}
          onClose={() => setPublishOpen(false)}
        />
      )}

      <Dialog open={knowledgeOpen} onOpenChange={setKnowledgeOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Bot className="h-4 w-4" />{t.notes.knowledgeTitle}</DialogTitle><DialogDescription>{t.notes.knowledgeDescription}</DialogDescription></DialogHeader>
          {knowledgeBusy && <p className="text-sm text-foreground-muted">{t.notes.knowledgeReviewing}</p>}
          {knowledgeError && <p className="text-sm text-destructive">{t.notes.knowledgeFailed}</p>}
          {knowledgeReview && <div className="space-y-3"><p className="text-sm text-foreground-muted">{knowledgeReview.summary}</p>{knowledgeReview.proposals.length === 0 ? <p className="text-sm text-foreground-muted">{t.notes.knowledgeEmpty}</p> : <ul className="space-y-2">{knowledgeReview.proposals.map((proposal) => <li key={`${proposal.kind}-${proposal.title}`} className="rounded-lg border border-border p-3"><div className="flex flex-wrap items-center gap-2"><SectionLabel>{t.notes.knowledgeKinds[proposal.kind as keyof typeof t.notes.knowledgeKinds] ?? proposal.kind}</SectionLabel><p className="font-medium">{proposal.title}</p></div><p className="mt-2 text-sm text-foreground-muted">{proposal.reason}</p><p className="mt-2 text-[10px] text-foreground-muted">{proposal.sourceIds.join(" · ")}</p></li>)}</ul>}<p className="text-xs text-foreground-subtle">{t.notes.knowledgeProposalNotice}</p></div>}
        </DialogContent>
      </Dialog>

      <NoteLinkPicker
        open={linkPickerOpen}
        onOpenChange={setLinkPickerOpen}
        query={linkPickerQuery}
        setQuery={setLinkPickerQuery}
        notes={notes.filter((n) => n.id !== selected?.id)}
        onPick={(n) => {
          editorHandleRef.current?.insertNoteLink(
            n.id,
            n.title || t.notes.untitled,
          );
          setLinkPickerOpen(false);
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function NoteRow({
  note,
  isActive,
  onSelect,
  dragHandle,
}: {
  note: Note;
  isActive: boolean;
  onSelect: () => void;
  dragHandle?: React.ReactNode;
}) {
  const t = useDict();
  const locale = useDateLocale();
  return (
    <motion.li
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      <div className="flex items-stretch">
        {dragHandle}
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "flex-1 text-left rounded-md px-2.5 py-2 transition-colors",
            isActive
              ? "bg-accent text-foreground"
              : "hover:bg-surface-hover text-foreground-muted hover:text-foreground",
          )}
        >
          <div className="flex items-center gap-1.5">
            {note.is_pinned && (
              <Pin className="h-3 w-3 text-warning shrink-0" />
            )}
            <span className="text-sm font-medium truncate">
              {note.title || t.notes.untitled}
            </span>
          </div>
          {note.tags && note.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {note.tags.slice(0, 4).map((tag) => {
                const c = tagColor(tag);
                return (
                  <span
                    key={tag}
                    className="text-[10px] rounded px-1 border"
                    style={{
                      background: c.bg,
                      color: c.text,
                      borderColor: c.border,
                    }}
                  >
                    {tag}
                  </span>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-foreground-muted tabular mt-0.5">
            {formatDistanceToNow(noteDate(note), {
              addSuffix: true,
              locale,
            })}
          </p>
        </button>
      </div>
    </motion.li>
  );
}

function SortableNoteRow({
  note,
  isActive,
  onSelect,
}: {
  note: Note;
  isActive: boolean;
  onSelect: () => void;
}) {
  const t = useDict();
  const locale = useDateLocale();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn("relative", isDragging && "z-10")}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          aria-label={t.notes.dragToReorder}
          {...attributes}
          {...listeners}
          className="shrink-0 flex items-center justify-center w-5 text-foreground-subtle hover:text-foreground cursor-grab active:cursor-grabbing focus-ring"
        >
          <GripVertical className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "flex-1 text-left rounded-md px-2 py-2 transition-colors",
            isActive
              ? "bg-accent text-foreground"
              : "hover:bg-surface-hover text-foreground-muted hover:text-foreground",
          )}
        >
          <div className="flex items-center gap-1.5">
            <Pin className="h-3 w-3 text-warning shrink-0" />
            <span className="text-sm font-medium truncate">
              {note.title || t.notes.untitled}
            </span>
          </div>
          {note.tags && note.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {note.tags.slice(0, 4).map((tag) => {
                const c = tagColor(tag);
                return (
                  <span
                    key={tag}
                    className="text-[10px] rounded px-1 border"
                    style={{
                      background: c.bg,
                      color: c.text,
                      borderColor: c.border,
                    }}
                  >
                    {tag}
                  </span>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-foreground-muted tabular mt-0.5">
            {formatDistanceToNow(noteDate(note), {
              addSuffix: true,
              locale,
            })}
          </p>
        </button>
      </div>
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function AddTagButton({ onAdd }: { onAdd: (tag: string) => void }) {
  const t = useDict();
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
          {t.notes.addTag}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="anim-pop z-40 w-56 rounded-lg border border-border bg-surface p-2 shadow-elevated"
        >
          <form onSubmit={submit} className="flex gap-1.5">
            <Input
              autoFocus
              placeholder={t.notes.addTagPlaceholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-8 text-xs"
            />
            <Button type="submit" size="sm">
              <Check className="h-3.5 w-3.5" />
            </Button>
          </form>
          <p className="text-[10px] text-foreground-subtle mt-1.5 px-1">
            {t.notes.tagHint}
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
  const t = useDict();
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="h-3.5 w-3.5" />
          {t.notes.importMd}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.notes.importFromMarkdown}</DialogTitle>
          <DialogDescription>{t.notes.importDialogDescription}</DialogDescription>
        </DialogHeader>
          <form onSubmit={submit} className="mt-3 space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder={t.notes.importPlaceholder}
              className="font-mono text-xs"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  {t.notes.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={busy || !text.trim()}>
                <Download className="h-3.5 w-3.5" />
                {busy ? t.notes.importing : t.notes.createNote}
              </Button>
            </div>
          </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function NoteLinkPicker({
  open,
  onOpenChange,
  query,
  setQuery,
  notes,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  query: string;
  setQuery: (v: string) => void;
  notes: Note[];
  onPick: (n: Note) => void;
}) {
  const t = useDict();
  const q = query.trim().toLowerCase();
  const results = q
    ? notes.filter((n) =>
        `${n.title}\n${n.plain_text ?? ""}`.toLowerCase().includes(q),
      )
    : notes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[20vh] max-w-md translate-y-0 overflow-hidden p-0"
        showClose={false}
      >
        <DialogTitle className="sr-only">{t.notes.linkToANote}</DialogTitle>
          <div className="flex items-center gap-2 px-3.5 border-b border-border">
            <Link2 className="h-4 w-4 text-foreground-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.notes.findNoteToLink}
              className="flex-1 h-11 bg-transparent text-sm outline-none placeholder:text-foreground-subtle"
            />
            <kbd className="text-[10px] text-foreground-subtle font-medium border border-border rounded px-1.5 py-0.5">
              {t.notes.esc}
            </kbd>
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-foreground-subtle">
                {notes.length === 0 ? t.notes.noOtherNotes : t.notes.noMatchesShort}
              </p>
            ) : (
              <ul>
                {results.slice(0, 50).map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onPick(n)}
                      className="w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors text-foreground-muted hover:text-foreground hover:bg-surface-hover"
                    >
                      <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {n.title || t.notes.untitled}
                        </p>
                        {n.plain_text && (
                          <p className="text-[11px] text-foreground-subtle truncate">
                            {n.plain_text.slice(0, 80)}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
      </DialogContent>
    </Dialog>
  );
}
