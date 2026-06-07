"use client";

// Headless BlockNote instance used only for Markdown → blocks parsing.
// Imported dynamically from notes-panel so it doesn't bloat the initial
// chunk for users who never click "Import from Markdown".
import {
  BlockNoteEditor,
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  type Block,
} from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";

// Match the live editor's schema so a pasted Markdown code fence becomes a
// Shiki-highlighted code block once the note is opened.
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec(codeBlockOptions),
  },
});

export async function markdownToBlocks(markdown: string): Promise<Block[]> {
  const editor = BlockNoteEditor.create({ schema });
  // tryParseMarkdownToBlocks accepts CommonMark-ish input and gives us
  // BlockNote blocks. Lossy in either direction, but round-trips well
  // for the basics: headings, paragraphs, lists, code blocks.
  return (await editor.tryParseMarkdownToBlocks(markdown)) as Block[];
}
