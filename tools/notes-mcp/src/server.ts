import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID = process.env.DASHBOARD_USER_ID; // your Supabase auth user UUID

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !USER_ID) {
  // NOTE: stdout is the MCP JSON-RPC channel — only ever log to stderr.
  console.error(
    "[notes-mcp] Missing env. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_USER_ID.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// BlockNote helpers — the dashboard stores notes.content as a BlockNote JSON
// document and notes.plain_text as a flattened copy (search / tsvector).
// ---------------------------------------------------------------------------
type Inline = { type: "text"; text: string; styles: Record<string, unknown> };
type Block = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: Inline[];
  children: Block[];
};

const base = {
  textColor: "default",
  backgroundColor: "default",
  textAlignment: "left",
};
const inline = (s: string): Inline[] =>
  s ? [{ type: "text", text: s, styles: {} }] : [];
const mk = (
  type: string,
  txt: string,
  props: Record<string, unknown> = {},
): Block => ({
  id: randomUUID(),
  type,
  props: { ...base, ...props },
  content: inline(txt),
  children: [],
});

/**
 * Minimal Markdown → BlockNote blocks: headings (#–###), bullet / numbered
 * lists, fenced code blocks, and paragraphs. Enough for Claude to write
 * readable notes without pulling BlockNote (and a DOM) into Node. For full
 * fidelity you could reuse src/components/notes/parse-markdown.ts behind a
 * jsdom shim.
 */
function markdownToBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^```(\w+)?\s*$/);
    if (fence) {
      const buf: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++)
        buf.push(lines[i]);
      out.push({
        id: randomUUID(),
        type: "codeBlock",
        props: { language: fence[1] ?? "text" },
        content: inline(buf.join("\n")),
        children: [],
      });
      continue;
    }
    const h = lines[i].match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      out.push(mk("heading", h[2], { level: h[1].length }));
      continue;
    }
    const b = lines[i].match(/^[-*]\s+(.*)$/);
    if (b) {
      out.push(mk("bulletListItem", b[1]));
      continue;
    }
    const n = lines[i].match(/^\d+\.\s+(.*)$/);
    if (n) {
      out.push(mk("numberedListItem", n[1]));
      continue;
    }
    if (lines[i].trim() === "") continue;
    out.push(mk("paragraph", lines[i]));
  }
  return out.length ? out : [mk("paragraph", "")];
}

/** Mirror of src/lib/notes-text.ts so search / tsvector stay consistent. */
function blocksToPlainText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  const walkInline = (c: unknown, o: string[]): void => {
    if (typeof c === "string") {
      o.push(c);
      return;
    }
    if (!Array.isArray(c)) return;
    for (const p of c) {
      if (!p || typeof p !== "object") continue;
      const piece = p as { text?: unknown; content?: unknown };
      if (typeof piece.text === "string") o.push(piece.text);
      else if (Array.isArray(piece.content)) walkInline(piece.content, o);
    }
  };
  const walkBlock = (blk: unknown, o: string[]): void => {
    if (!blk || typeof blk !== "object") return;
    const x = blk as { content?: unknown; children?: unknown };
    const line: string[] = [];
    walkInline(x.content, line);
    if (line.length) o.push(line.join(""));
    if (Array.isArray(x.children)) for (const ch of x.children) walkBlock(ch, o);
  };
  for (const blk of blocks) walkBlock(blk, parts);
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------
const server = new McpServer({ name: "own-dashboard-notes", version: "1.0.0" });

server.registerTool(
  "create_note",
  {
    title: "Create note",
    description:
      "Create a new note in the dashboard. The body is Markdown (headings, bullet/numbered lists, and code fences are supported).",
    inputSchema: {
      title: z.string().describe("Note title"),
      markdown: z.string().describe("Note body as Markdown"),
      tags: z.array(z.string()).optional().describe("Optional tags"),
      pinned: z.boolean().optional().describe("Pin the note to the top"),
    },
  },
  async ({ title, markdown, tags, pinned }) => {
    const content = markdownToBlocks(markdown ?? "");
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("notes")
      .insert({
        user_id: USER_ID,
        title: title.trim() || "Untitled",
        content,
        plain_text: blocksToPlainText(content),
        tags: tags ?? [],
        is_pinned: pinned ?? false,
        sort_order: Date.now(), // higher = earlier within its pinned bucket
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    return error
      ? { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] }
      : {
          content: [
            { type: "text", text: `Created note "${title}" (id ${data.id}).` },
          ],
        };
  },
);

server.registerTool(
  "list_notes",
  {
    title: "List notes",
    description: "List recent notes (id, title, tags, updated_at).",
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ limit }) => {
    const { data, error } = await supabase
      .from("notes")
      .select("id, title, tags, updated_at")
      .eq("user_id", USER_ID)
      .order("updated_at", { ascending: false })
      .limit(limit ?? 20);
    return error
      ? { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] }
      : { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.registerTool(
  "append_to_note",
  {
    title: "Append to note",
    description: "Append Markdown content to an existing note, found by id.",
    inputSchema: {
      id: z.string().describe("Note id"),
      markdown: z.string().describe("Markdown to append"),
    },
  },
  async ({ id, markdown }) => {
    const { data: existing, error: readErr } = await supabase
      .from("notes")
      .select("content")
      .eq("id", id)
      .eq("user_id", USER_ID)
      .single();
    if (readErr || !existing) {
      return {
        isError: true,
        content: [{ type: "text", text: `Note not found: ${id}` }],
      };
    }
    const current = Array.isArray(existing.content)
      ? (existing.content as Block[])
      : [];
    const merged = [...current, ...markdownToBlocks(markdown)];
    const { error } = await supabase
      .from("notes")
      .update({
        content: merged,
        plain_text: blocksToPlainText(merged),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", USER_ID);
    return error
      ? { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] }
      : { content: [{ type: "text", text: `Appended to note ${id}.` }] };
  },
);

await server.connect(new StdioServerTransport());
console.error("[notes-mcp] ready");
