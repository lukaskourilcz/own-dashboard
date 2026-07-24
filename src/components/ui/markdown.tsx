import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free markdown renderer for trusted content (a file the
 * user authored in their own repo). It builds React elements — it never injects
 * raw HTML — so there is no XSS surface. Handles headings, ordered/unordered
 * lists, fenced code blocks, GFM tables, paragraphs, and inline bold / code /
 * links.
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

/** Split a `| a | b |` table row into trimmed cells (outer pipes stripped). */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** A GFM separator row like `| --- | :--: | ---: |`. */
function isTableSeparator(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** Column alignment from a separator cell (`:--` left, `--:` right, `:-:` centre). */
function alignClass(sep: string): string {
  const c = sep.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  if (left && right) return "text-center";
  if (right) return "text-right";
  return "text-left";
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

    // GFM table — a header row followed by a `---` separator row.
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const header = splitTableRow(line);
      const aligns = splitTableRow(lines[i + 1]).map(alignClass);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const tk = key++;
      blocks.push(
        <div key={tk} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((cell, ci) => (
                  <th
                    key={ci}
                    className={cn(
                      "border-b border-border px-2 py-1.5 font-semibold text-foreground",
                      aligns[ci] ?? "text-left",
                    )}
                  >
                    {renderInline(cell, `th${tk}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        "border-b border-border/60 px-2 py-1.5 align-top text-foreground-muted",
                        aligns[ci] ?? "text-left",
                      )}
                    >
                      {renderInline(row[ci] ?? "", `td${tk}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
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
