"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import dynamic from "next/dynamic";
import type { NoteEditorHandle } from "@/components/notes/note-editor";
import type { Block } from "@blocknote/core";
import { Skeleton } from "@/components/ui/skeleton";
import { useDict } from "@/lib/i18n";

// Reuse the exact rich editor from the Notes section (BlockNote). Loaded lazily
// — it's heavy and client-only.
const NoteEditor = dynamic(
  () => import("@/components/notes/note-editor").then((m) => m.NoteEditor),
  { ssr: false, loading: () => <Skeleton className="h-24 w-full" /> },
);

/**
 * A project's free-form notes, edited with the same BlockNote editor as the
 * Notes section. The project stores notes as a single markdown `text` column,
 * so we parse markdown → blocks on mount and serialize blocks → markdown on
 * change. Autosaves (debounced by the editor itself) — no save button.
 */
export function ProjectNotesEditor({
  projectId,
  initialMarkdown,
  onSaveMarkdown,
  onDirtyChange,
  editorRef,
}: {
  projectId: string;
  initialMarkdown: string;
  onSaveMarkdown: (markdown: string) => void;
  onDirtyChange?: () => void;
  editorRef?: RefObject<NoteEditorHandle | null>;
}) {
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [parseFailed, setParseFailed] = useState(false);
  const t = useDict();
  const onSaveRef = useRef(onSaveMarkdown);
  useEffect(() => {
    onSaveRef.current = onSaveMarkdown;
  }, [onSaveMarkdown]);

  // Parse the stored markdown into blocks once per project.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { markdownToBlocks } = await import(
        "@/components/notes/parse-markdown"
      );
      const parsed = await markdownToBlocks(initialMarkdown || "");
      if (!cancelled) setBlocks(parsed);
    })().catch(() => { if (!cancelled) setParseFailed(true); });
    return () => {
      cancelled = true;
    };
    // Reparse only when switching projects, not on every keystroke-driven
    // markdown change (the editor owns the live document after mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (parseFailed) return <p role="alert" className="p-3 text-xs text-destructive">{t.projects.notesLoadFailed}</p>;
  if (!blocks) return <Skeleton className="h-24 w-full" />;

  return (
    <NoteEditor
      key={projectId}
      noteId={projectId}
      initialContent={blocks}
      handleRef={editorRef}
      onDirtyChange={onDirtyChange}
      onChange={() => undefined}
      onMarkdownChange={(markdown) => onSaveRef.current(markdown)}
    />
  );
}
