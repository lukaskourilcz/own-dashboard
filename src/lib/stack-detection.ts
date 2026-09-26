/**
 * Deterministic reading of a repository's stack for the Tools section.
 *
 * The shared markdown contract (`src/lib/new-project-guide.ts`) keeps a
 * project's stack in its root `about-project.md`, under `## Tech stack` and
 * `## Third-party libraries`, one bullet per entry written as
 * `Name — what it does`. A repository without those sections, or whose
 * sections list nothing in that form, falls back to the direct runtime
 * `dependencies` of its root `package.json`.
 *
 * Everything here is string parsing: no model is called and nothing leaves
 * the process. Client-safe, so the Tools panel can merge the result with the
 * tools the owner added by hand.
 */

export type StackSource = "about-project" | "package-json";

/** One tool as a single repository lists it. */
export type StackEntry = {
  /** Display name, without a trailing version or a parenthetical note. */
  name: string;
  /** Case- and accent-insensitive identity used to merge entries. */
  key: string;
  /** What the bullet says the tool does; empty for a package.json entry. */
  whatItDoes: string;
  /** How many tools the bullet named; 1 is the most specific description. */
  specificity: number;
};

/** One project's use of a detected tool. */
export type DetectedToolProject = {
  id: string;
  name: string;
  note: string;
  source: StackSource;
};

/** A tool found in one or more active projects' repositories. */
export type DetectedTool = {
  key: string;
  name: string;
  whatItDoes: string;
  projects: DetectedToolProject[];
};

/** Why a project contributed the tools it did, or none. */
export type RepoStackStatus =
  | "ok"
  | "empty"
  | "not-found"
  | "unreadable"
  | "error"
  | "no-repository"
  | "inherited"
  | "skipped";

export type ProjectStackStatus = {
  projectId: string;
  projectName: string;
  repo: string | null;
  status: RepoStackStatus;
  source: StackSource | null;
  toolCount: number;
  /** For a subsection read through its parent's repository. */
  parentName?: string;
};

/** What `GET /api/tools/detected` returns. */
export type DetectedToolsResponse = {
  /** False when GitHub is not connected or its access was revoked. */
  connected: boolean;
  checkedAt: string;
  projects: ProjectStackStatus[];
  tools: DetectedTool[];
};

/** How many repositories one detection reads; the rest are reported as skipped. */
export const MAX_DETECTED_REPOSITORIES = 12;

/** The two contract headings, normalized. */
const STACK_HEADINGS = new Set(["tech stack", "third party libraries"]);

/** Bounds, so one unusual file cannot flood the Tools list. */
const MAX_ENTRIES = 150;
const MAX_NAME_LENGTH = 60;
const MAX_NAME_WORDS = 5;
const MAX_NOTE_LENGTH = 300;

function foldAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Identity for merging: case, accents and spacing never split one tool. */
export function toolKey(name: string): string {
  return foldAccents(name).toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

function normalizeHeading(text: string): string {
  return foldAccents(stripMarkdown(text))
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Plain text of an inline markdown fragment. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,;:])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a list of names on commas and on "and" (English), "a" (Czech), "&"
 * and "+", but never inside parentheses: "Buffer a Meta Graph API
 * (Instagram, Threads)" is two names, not three.
 */
function splitNames(text: string): string[] {
  const separators = [", ", ",", " and ", " a ", " & ", " + "];
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "(" || char === "[") depth += 1;
    if ((char === ")" || char === "]") && depth > 0) depth -= 1;
    if (depth === 0) {
      const lower = text.slice(index, index + 5).toLocaleLowerCase("en");
      const separator = separators.find((candidate) => lower.startsWith(candidate));
      if (separator) {
        parts.push(current);
        current = "";
        index += separator.length;
        continue;
      }
    }
    current += char;
    index += 1;
  }
  parts.push(current);
  return parts;
}

const VERSION_TOKEN = /^v?\d+(\.\d+)*(\.x|\+)?$/i;

/**
 * A readable tool name, or null when the text is not a name: empty, a
 * sentence, a directory path or a label.
 */
function cleanName(raw: string): string | null {
  let name = stripMarkdown(raw)
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/^[\s:;.,–—-]+|[\s:;.,–—-]+$/g, "")
    .trim();
  const tokens = name.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && VERSION_TOKEN.test(tokens[tokens.length - 1]!)) tokens.pop();
  name = tokens.join(" ");
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  if (tokens.length > MAX_NAME_WORDS) return null;
  if (!/[\p{L}\p{N}]/u.test(name)) return null;
  // A directory such as `state/` describes where something lives, not a tool.
  if (tokens.some((token) => /\/$/.test(token))) return null;
  if (/:\s/.test(name)) return null;
  return name;
}

type ParsedBullet = { names: string[]; whatItDoes: string } | { label: true };

/** The first ` — `, ` – ` or ` - ` separator in a bullet. */
function findDash(text: string): RegExpExecArray | null {
  return /\s[—–]\s/.exec(text) ?? /\s-\s/.exec(text);
}

/** `**Name** — what it does`, `Name — what it does` or a bare `Name`. */
function parseBullet(text: string): ParsedBullet | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let nameText: string;
  let rest: string;
  const bold = /^\*\*(.+?)\*\*(.*)$/.exec(trimmed) ?? /^__(.+?)__(.*)$/.exec(trimmed);
  if (bold) {
    // `**Reader:** Next.js, React` names a layer of the stack, not a tool.
    if (/:\s*$/.test(bold[1]!)) return { label: true };
    const after = bold[2]!;
    const separator = /^\s*(?:[—–:]|-(?=\s))\s*/.exec(after);
    const dash = findDash(after);
    if (separator) {
      nameText = bold[1]!;
      rest = after.slice(separator[0].length);
    } else if (dash) {
      // `**Supabase** and **Postgres** — …`: the names run up to the dash.
      nameText = bold[1]! + after.slice(0, dash.index);
      rest = after.slice(dash.index + dash[0].length);
    } else {
      nameText = bold[1]!;
      rest = after;
    }
  } else {
    const dash = findDash(trimmed);
    if (dash) {
      nameText = trimmed.slice(0, dash.index);
      rest = trimmed.slice(dash.index + dash[0].length);
    } else {
      nameText = trimmed;
      rest = "";
    }
  }
  // A list of names is names all the way through. One part that reads as a
  // sentence or a path means the bullet is prose, and splitting it on "a" or
  // "and" would invent tools.
  const parts = splitNames(nameText).filter((part) => stripMarkdown(part).length > 0);
  const names = parts.map(cleanName);
  if (names.length === 0 || names.some((name) => name === null)) return null;
  const whatItDoes = stripMarkdown(rest).slice(0, MAX_NOTE_LENGTH).trim();
  return { names: names as string[], whatItDoes };
}

/**
 * The tools an `about-project.md` lists under `## Tech stack` and
 * `## Third-party libraries`. `hasSections` says whether either heading was
 * there at all; `labels` counts bullets written as `**Label:** …`, which name a
 * layer rather than a tool and are left out.
 */
export function parseAboutProjectStack(markdown: string): {
  hasSections: boolean;
  entries: StackEntry[];
  labels: number;
} {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const bullets: string[] = [];
  let hasSections = false;
  let sectionLevel = 0;
  let inFence = false;
  let current: string | null = null;
  const flush = () => {
    if (current !== null) bullets.push(current);
    current = null;
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      if (STACK_HEADINGS.has(normalizeHeading(heading[2]!))) {
        hasSections = true;
        sectionLevel = level;
      } else if (sectionLevel && level <= sectionLevel) {
        sectionLevel = 0;
      }
      continue;
    }
    if (!sectionLevel) continue;
    const bullet = /^\s{0,6}(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      current = bullet[1]!;
    } else if (!line.trim()) {
      flush();
    } else if (current !== null) {
      current += ` ${line.trim()}`;
    }
  }
  flush();

  const entries: StackEntry[] = [];
  let labels = 0;
  for (const text of bullets) {
    const parsed = parseBullet(text);
    if (!parsed) continue;
    if ("label" in parsed) {
      labels += 1;
      continue;
    }
    for (const name of parsed.names) {
      entries.push({
        name,
        key: toolKey(name),
        whatItDoes: parsed.whatItDoes,
        specificity: parsed.names.length,
      });
    }
  }
  return { hasSections, entries: entries.slice(0, MAX_ENTRIES), labels };
}

/**
 * The direct runtime dependencies of a root `package.json`, by package name.
 * Null when the text is not a JSON object; dev dependencies are never read.
 */
export function parsePackageJsonStack(text: string): StackEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const dependencies = (parsed as { dependencies?: unknown }).dependencies;
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return [];
  return Object.keys(dependencies)
    .filter((name) => name.trim().length > 0 && name.length <= 214)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_ENTRIES)
    .map((name) => ({ name, key: toolKey(name), whatItDoes: "", specificity: 1 }));
}

/** One project's parsed stack, as the detection route collects it. */
export type ProjectStack = {
  project: { id: string; name: string };
  source: StackSource;
  entries: StackEntry[];
};

/**
 * One entry per tool across the given projects, merged by `toolKey`, each
 * with the projects that list it. A project that lists a tool twice (a
 * compound bullet and a bullet of its own) keeps the more specific note. The
 * shown description is the most specific one across projects, and the shown
 * name prefers a capitalized spelling ("Supabase" over "supabase").
 */
export function mergeDetectedTools(stacks: readonly ProjectStack[]): DetectedTool[] {
  type Draft = {
    key: string;
    names: string[];
    best: { note: string; specificity: number } | null;
    projects: Map<string, DetectedToolProject & { specificity: number }>;
  };
  const drafts = new Map<string, Draft>();
  for (const { project, source, entries } of stacks) {
    for (const entry of entries) {
      if (!entry.key) continue;
      const draft: Draft = drafts.get(entry.key) ?? { key: entry.key, names: [], best: null, projects: new Map() };
      drafts.set(entry.key, draft);
      draft.names.push(entry.name);
      if (entry.whatItDoes && (!draft.best || entry.specificity < draft.best.specificity)) {
        draft.best = { note: entry.whatItDoes, specificity: entry.specificity };
      }
      const existing = draft.projects.get(project.id);
      if (!existing || entry.specificity < existing.specificity) {
        draft.projects.set(project.id, {
          id: project.id,
          name: project.name,
          note: entry.whatItDoes,
          source,
          specificity: entry.specificity,
        });
      }
    }
  }
  return [...drafts.values()]
    .map((draft) => ({
      key: draft.key,
      name: draft.names.find((name) => name !== name.toLocaleLowerCase("en")) ?? draft.names[0]!,
      whatItDoes: draft.best?.note ?? "",
      projects: [...draft.projects.values()].map((usage) => ({
        id: usage.id,
        name: usage.name,
        note: usage.note,
        source: usage.source,
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.key.localeCompare(b.key));
}

/**
 * Split detected tools into those the owner already added by hand (matched
 * by any of the hand-added tool's names, case-insensitively) and the rest. A
 * match never adds a second entry: the hand-added tool shows which
 * repositories also list it.
 */
export function partitionDetectedTools<T>(
  detected: readonly DetectedTool[],
  manual: readonly T[],
  manualNames: (tool: T) => readonly (string | null | undefined)[],
): { unmatched: DetectedTool[]; matches: Map<T, DetectedTool> } {
  const manualByKey = new Map<string, T>();
  for (const tool of manual) {
    for (const name of manualNames(tool)) {
      const key = name ? toolKey(name) : "";
      if (key && !manualByKey.has(key)) manualByKey.set(key, tool);
    }
  }
  const matches = new Map<T, DetectedTool>();
  const unmatched: DetectedTool[] = [];
  for (const tool of detected) {
    const owner = manualByKey.get(tool.key);
    if (owner) matches.set(owner, tool);
    else unmatched.push(tool);
  }
  return { unmatched, matches };
}
