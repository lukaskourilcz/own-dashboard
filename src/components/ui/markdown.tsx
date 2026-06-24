import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free markdown renderer for trusted content (a file the
 * user authored in their own repo). It builds React elements — it never injects
 * raw HTML — so there is no XSS surface. Handles headings, ordered/unordered
 * lists, fenced code blocks, paragraphs, and inline bold / code / links.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // One pass over **bold**, `code`, and [label](url).
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${i++}`;
    if (m[2] != null) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {m[2]}
        </strong>,
      );
    } else if (m[3] != null) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {m[3]}
        </code>,
      );
    } else if (m[4] != null && m[5] != null) {
      const href = m[5];
      const safe = /^https?:\/\//i.test(href);
      nodes.push(
        safe ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-2 hover:no-underline"
          >
            {m[4]}
          </a>
        ) : (
          m[4]
        ),
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line.trim())) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-md bg-surface-muted p-2.5 text-[11px] leading-relaxed"
        >
          <code className="font-mono">{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls =
        level <= 1
          ? "mt-1 text-sm font-semibold text-foreground"
          : level === 2
            ? "mt-3 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted"
            : "mt-2 text-[13px] font-semibold text-foreground";
      blocks.push(
        <p key={key++} className={cls}>
          {renderInline(h[2].trim(), `h${key}`)}
        </p>,
      );
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const txt = lines[i].replace(/^\s*[-*]\s+/, "");
        items.push(
          <li key={items.length}>{renderInline(txt, `li${key}-${items.length}`)}</li>,
        );
        i++;
      }
      blocks.push(
        <ul
          key={key++}
          className="ml-4 list-disc space-y-0.5 text-foreground-muted"
        >
          {items}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const txt = lines[i].replace(/^\s*\d+\.\s+/, "");
        items.push(
          <li key={items.length}>
            {renderInline(txt, `oli${key}-${items.length}`)}
          </li>,
        );
        i++;
      }
      blocks.push(
        <ol
          key={key++}
          className="ml-4 list-decimal space-y-0.5 text-foreground-muted"
        >
          {items}
        </ol>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — gather consecutive plain lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="leading-relaxed text-foreground-muted">
        {renderInline(para.join(" "), `p${key}`)}
      </p>,
    );
  }

  return (
    <div className={cn("space-y-2 text-xs", className)}>{blocks}</div>
  );
}
