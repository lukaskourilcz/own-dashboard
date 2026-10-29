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
import { useDict } from "@/lib/i18n";
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
  getDocument: () => { title: string; content: Block[]; plainText: string };
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
  /** Project notes need the same captured document even while refs detach on unmount. */
  onMarkdownChange?: (markdown: string) => void;
  /** Cheap immediate notification; persistence still uses the debounce. */
  onDirtyChange?: () => void;
  handleRef?: React.RefObject<NoteEditorHandle | null>;
  editable?: boolean;
  /** Called when the user picks the "Link to note" slash menu item. The
   * parent is expected to open a notes picker and then call
   * `handle.insertNoteLink(id, title)` once a note is chosen. */
  onRequestNoteLink?: () => void;
  /** Called when an internal note link is clicked inside the editor. */
  onNavigateToNote?: (noteId: string) => void;
};

function extractTitle(doc: Block[], fallback: string): string {
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
  return fallback;
}

export function NoteEditor({
  initialContent,
  onChange,
  onMarkdownChange,
  onDirtyChange,
  handleRef,
  editable = true,
  onRequestNoteLink,
  onNavigateToNote,
}: Props) {
  const { theme } = useTheme();
  const t = useDict();
  const hostRef = useRef<HTMLDivElement>(null);

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

  // BlockNote does not expose a contenteditable aria-label prop. Name the
  // mounted TipTap input directly so assistive technology announces the
  // editor as a real input field rather than an anonymous region. BlockNote
  // can replace the editable node after our first effect, so keep the label
  // attached across its internal mount cycle.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const applyLabel = () => {
      const input = host.querySelector<HTMLElement>(".tiptap");
      if (input?.getAttribute("aria-label") !== t.notes.editorLabel) {
        input?.setAttribute("aria-label", t.notes.editorLabel);
      }
      input?.setAttribute("aria-readonly", String(!editable));
      if (input && !editable) input.tabIndex = 0;
      input?.classList.toggle("focus-ring", !editable);
    };
    applyLabel();
    const observer = new MutationObserver(applyLabel);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [editor, editable, t.notes.editorLabel]);

  useImperativeHandle(
    handleRef ?? { current: null },
    () => ({
      getDocument: () => {
        const content = editor.document as Block[];
        return { title: extractTitle(content, t.notes.untitled), content, plainText: blocksToPlainText(content) };
      },
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
    [editor, t.notes.untitled],
  );

  // Debounced onChange — fire 600ms after the last edit.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onMarkdownChangeRef = useRef(onMarkdownChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onLinkRef = useRef(onRequestNoteLink);
  const titleFallbackRef = useRef(t.notes.untitled);
  useEffect(() => {
    onChangeRef.current = onChange;
    onMarkdownChangeRef.current = onMarkdownChange;
    onDirtyChangeRef.current = onDirtyChange;
    onLinkRef.current = onRequestNoteLink;
    titleFallbackRef.current = t.notes.untitled;
  }, [onChange, onMarkdownChange, onDirtyChange, onRequestNoteLink, t]);

  useEffect(() => {
    if (!editor) return;
    const unsubscribe = editor.onChange(() => {
      changedRef.current = true;
      onDirtyChangeRef.current?.();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const doc = editor.document as Block[];
        onChangeRef.current({
          title: extractTitle(doc, titleFallbackRef.current),
          content: doc,
          plainText: blocksToPlainText(doc),
        });
        onMarkdownChangeRef.current?.(editor.blocksToMarkdownLossy(doc));
        changedRef.current = false;
        timerRef.current = null;
      }, 600);
    });
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (changedRef.current) {
        const doc = editor.document as Block[];
        onChangeRef.current({
          title: extractTitle(doc, titleFallbackRef.current),
          content: doc,
          plainText: blocksToPlainText(doc),
        });
        onMarkdownChangeRef.current?.(editor.blocksToMarkdownLossy(doc));
      }
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
    <div ref={hostRef} className="bn-host" onClickCapture={onClickCapture} onKeyDownCapture={event => {
      if (editable || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "a") return;
      const input = hostRef.current?.querySelector<HTMLElement>(".tiptap");
      if (!input || !input.contains(event.target as Node)) return;
      const selection = input.ownerDocument.getSelection();
      if (selection) { event.preventDefault(); selection.selectAllChildren(input); }
    }}>
      <BlockNoteView
        editable={editable}
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
                  title: t.notes.linkToNote,
                  subtext: t.notes.linkToNoteSubtext,
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
