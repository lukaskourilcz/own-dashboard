"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Block } from "@blocknote/core";
import { Skeleton } from "@/components/ui/skeleton";
import type { NoteEditorHandle } from "@/components/notes/note-editor";

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
}: {
  projectId: string;
  initialMarkdown: string;
  onSaveMarkdown: (markdown: string) => void;
}) {
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const handleRef = useRef<NoteEditorHandle | null>(null);
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
    })();
    return () => {
      cancelled = true;
    };
    // Reparse only when switching projects, not on every keystroke-driven
    // markdown change (the editor owns the live document after mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (!blocks) return <Skeleton className="h-24 w-full" />;

  return (
    <NoteEditor
      key={projectId}
      noteId={projectId}
      initialContent={blocks}
      handleRef={handleRef}
      // The editor debounces onChange (~600ms). We ignore the block payload and
      // serialize to markdown via the handle, then persist.
      onChange={() => {
        void handleRef.current
          ?.toMarkdown()
          .then((md) => onSaveRef.current(md));
      }}
    />
  );
}
