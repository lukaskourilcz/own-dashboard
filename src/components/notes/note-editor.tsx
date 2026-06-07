"use client";

import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import {
  useCreateBlockNote,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  filterSuggestionItems,
  type Block,
} from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
import { Link2 } from "lucide-react";
import { useTheme } from "@/lib/use-theme";
import { blocksToPlainText } from "@/lib/notes-text";

// One schema reused across editor instances — wires Shiki-backed code blocks
// (~40 languages pre-bundled) into the default block set.
const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec(codeBlockOptions),
  },
});

/** Imperative handle exposed via ref. */
export type NoteEditorHandle = {
  toMarkdown: () => Promise<string>;
  insertNoteLink: (noteId: string, title: string) => void;
};

/** Internal href format for an in-app note link. Parsed by the click
 * interceptor to navigate without leaving the page. */
export const NOTE_LINK_PREFIX = "#/notes/";

type Props = {
  noteId: string; // Used as key by caller so editor remounts per note.
  initialContent: Block[];
  onChange: (doc: {
    title: string;
    content: Block[];
    plainText: string;
  }) => void;
  handleRef?: React.RefObject<NoteEditorHandle | null>;
  /** Called when the user picks the "Link to note" slash menu item. The
   * parent is expected to open a notes picker and then call
   * `handle.insertNoteLink(id, title)` once a note is chosen. */
  onRequestNoteLink?: () => void;
  /** Called when an internal note link is clicked inside the editor. */
  onNavigateToNote?: (noteId: string) => void;
};

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

export function NoteEditor({
  initialContent,
  onChange,
  handleRef,
  onRequestNoteLink,
  onNavigateToNote,
}: Props) {
  const { theme } = useTheme();

  const seed = useMemo<Block[]>(() => {
    if (Array.isArray(initialContent) && initialContent.length > 0) {
      return initialContent;
    }
    return [
      {
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
    schema: editorSchema,
  });

  useImperativeHandle(
    handleRef ?? { current: null },
    () => ({
      toMarkdown: async () => {
        return await editor.blocksToMarkdownLossy(editor.document as Block[]);
      },
      insertNoteLink: (noteId: string, title: string) => {
        // BlockNote's built-in link inline content. We use a synthetic
        // hash-style href so the click interceptor can detect it.
        editor.insertInlineContent([
          {
            type: "link",
            href: `${NOTE_LINK_PREFIX}${noteId}`,
            content: title,
          },
          " ",
        ]);
        editor.focus();
      },
    }),
    [editor],
  );

  // Debounced onChange — fire 600ms after the last edit.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  const onLinkRef = useRef(onRequestNoteLink);
  useEffect(() => {
    onChangeRef.current = onChange;
    onLinkRef.current = onRequestNoteLink;
  }, [onChange, onRequestNoteLink]);

  useEffect(() => {
    if (!editor) return;
    const unsubscribe = editor.onChange(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const doc = editor.document as Block[];
        onChangeRef.current({
          title: extractTitle(doc),
          content: doc,
          plainText: blocksToPlainText(doc),
        });
      }, 600);
    });
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const doc = editor.document as Block[];
      onChangeRef.current({
        title: extractTitle(doc),
        content: doc,
        plainText: blocksToPlainText(doc),
      });
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [editor]);

  // Intercept clicks on in-app note links: navigate inside the dashboard
  // instead of letting the browser jump to a missing anchor.
  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest("a") as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href.startsWith(NOTE_LINK_PREFIX)) return;
    e.preventDefault();
    e.stopPropagation();
    const id = href.slice(NOTE_LINK_PREFIX.length);
    if (id && onNavigateToNote) onNavigateToNote(id);
  }

  return (
    <div className="bn-host" onClickCapture={onClickCapture}>
      <BlockNoteView
        editor={editor}
        theme={theme === "dark" ? "dark" : "light"}
        slashMenu={false}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [
                ...getDefaultReactSlashMenuItems(editor),
                {
                  title: "Link to note",
                  subtext: "Reference another note",
                  aliases: ["link", "note", "ref", "mention"],
                  group: "Embeds",
                  icon: <Link2 className="h-4 w-4" />,
                  onItemClick: () => onLinkRef.current?.(),
                },
              ],
              query,
            )
          }
        />
      </BlockNoteView>
    </div>
  );
}
