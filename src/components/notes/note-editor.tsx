"use client";

import { useEffect, useMemo, useRef } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import type { Block } from "@blocknote/core";
import { useTheme } from "@/lib/use-theme";

type Props = {
  noteId: string; // Used as key by caller so editor remounts per note.
  initialContent: Block[];
  onChange: (doc: { title: string; content: Block[] }) => void;
};

/**
 * Derive a title from the doc's first non-empty block. Falls back to
 * "Untitled" when the doc is blank.
 */
function extractTitle(doc: Block[]): string {
  for (const block of doc) {
    const content = block.content;
    if (Array.isArray(content)) {
      const text = content
        .map((c) => ("text" in c ? c.text : ""))
        .join("")
        .trim();
      if (text) return text.slice(0, 80);
    }
  }
  return "Untitled";
}

export function NoteEditor({ initialContent, onChange }: Props) {
  const { theme } = useTheme();

  // BlockNote requires at least one block to mount; provide a neutral
  // empty paragraph when the note is new.
  const seed = useMemo<Block[]>(() => {
    if (Array.isArray(initialContent) && initialContent.length > 0) {
      return initialContent;
    }
    return [
      {
        // The shape BlockNote expects for an empty paragraph.
        id: "init",
        type: "paragraph",
        props: {
          textColor: "default",
          backgroundColor: "default",
          textAlignment: "left",
        },
        content: [],
        children: [],
      } as unknown as Block,
    ];
  }, [initialContent]);

  const editor = useCreateBlockNote({
    initialContent: seed,
  });

  // Debounced onChange — fire 600ms after the last edit. We don't want a
  // network call on every keystroke, but we also don't want to lose the
  // last few characters when the user navigates away.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!editor) return;
    const unsubscribe = editor.onChange(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const doc = editor.document as Block[];
        onChangeRef.current({ title: extractTitle(doc), content: doc });
      }, 600);
    });
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Flush pending change so we don't drop trailing edits on unmount.
      const doc = editor.document as Block[];
      onChangeRef.current({ title: extractTitle(doc), content: doc });
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [editor]);

  return (
    <div className="bn-host">
      <BlockNoteView
        editor={editor}
        theme={theme === "dark" ? "dark" : "light"}
      />
    </div>
  );
}
