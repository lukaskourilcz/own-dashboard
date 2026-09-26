import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mergeDetectedTools,
  parseAboutProjectStack,
  parsePackageJsonStack,
  partitionDetectedTools,
  toolKey,
  type StackEntry,
} from "@/lib/stack-detection";

const names = (entries: StackEntry[]) => entries.map((entry) => entry.name);

describe("parseAboutProjectStack", () => {
  it("reads both contract sections and splits compound bullets", () => {
    const { hasSections, entries, labels } = parseAboutProjectStack(`# Demo

Summary paragraph that mentions React and should be ignored.

## Tech stack

- **Next.js 16 (App Router) and TypeScript** — the shell and API routes
- **Tailwind CSS 4, Radix primitives, Recharts** — UI and charts

## Third-party libraries

- **Supabase** — Postgres, auth and row-level security
- **ARES and VIES** — public registries
- \`react-syntax-highlighter\`, \`devicon\` — code visuals
- Plain Name – with an en dash

## Deployment

- **Ignored** — not a stack section
`);
    expect(hasSections).toBe(true);
    expect(labels).toBe(0);
    expect(names(entries)).toEqual([
      "Next.js",
      "TypeScript",
      "Tailwind CSS",
      "Radix primitives",
      "Recharts",
      "Supabase",
      "ARES",
      "VIES",
      "react-syntax-highlighter",
      "devicon",
      "Plain Name",
    ]);
    const supabase = entries.find((entry) => entry.name === "Supabase")!;
    expect(supabase.whatItDoes).toBe("Postgres, auth and row-level security");
    expect(supabase.specificity).toBe(1);
    expect(entries.find((entry) => entry.name === "Recharts")!.specificity).toBe(3);
  });

  it("splits Czech lists on 'a', keeps parenthesised lists whole and joins continuation lines", () => {
    const { entries } = parseAboutProjectStack(`## Tech stack

- **TypeScript, Node.js 22 a pnpm** — jeden workspace se třemi balíčky: \`orchestrator\`, \`site\`
  a \`studio\`
- **\`state/\` v Gitu** — záznamy porad; databázi projekt nemá

## Third-party libraries

- **Buffer a Meta Graph API (Instagram, Threads)** — publikování na sociální sítě
`);
    expect(names(entries)).toEqual(["TypeScript", "Node.js", "pnpm", "Buffer", "Meta Graph API"]);
    expect(entries[0]!.whatItDoes).toBe("jeden workspace se třemi balíčky: orchestrator, site a studio");
  });

  it("skips label bullets, which name a layer rather than a tool", () => {
    const { hasSections, entries, labels } = parseAboutProjectStack(`## Tech stack

- **Reader:** Next.js App Router, React and strict TypeScript.
- **Client:** React + Vite + TypeScript, React Router, TanStack Query
- **Stripe** — optional support
`);
    expect(hasSections).toBe(true);
    expect(labels).toBe(2);
    expect(names(entries)).toEqual(["Stripe"]);
  });

  it("accepts a colon after a bold name and names that run up to the dash", () => {
    const { entries } = parseAboutProjectStack(`### Third party libraries

- **Resend**: optional email
- **Sentry** and **PostHog** — monitoring and analytics
* Upstash Redis
1. Vercel - hosting
`);
    expect(entries.map((entry) => [entry.name, entry.whatItDoes])).toEqual([
      ["Resend", "optional email"],
      ["Sentry", "monitoring and analytics"],
      ["PostHog", "monitoring and analytics"],
      ["Upstash Redis", ""],
      ["Vercel", "hosting"],
    ]);
  });

  it("ignores fenced code, other headings, prose and sentence-length names", () => {
    const { hasSections, entries } = parseAboutProjectStack(`## Tech stack

\`\`\`
- **Fenced** — not a bullet
\`\`\`

A paragraph between bullets.

- This bullet is a whole sentence without any separator in it at all
- * *

### Frontend

- **Nested** — still inside Tech stack

## Something else

- **Outside** — after the section
`);
    expect(hasSections).toBe(true);
    expect(names(entries)).toEqual(["Nested"]);
  });

  it("reports a file without either section", () => {
    expect(parseAboutProjectStack("# Only a title\n\n- **React** — UI\n")).toEqual({
      hasSections: false,
      entries: [],
      labels: 0,
    });
  });

  it("reads this repository's own about-project.md", () => {
    const markdown = readFileSync(new URL("../../about-project.md", import.meta.url), "utf8");
    const { hasSections, entries, labels } = parseAboutProjectStack(markdown);
    expect(hasSections).toBe(true);
    expect(labels).toBe(0);
    const found = new Set(names(entries));
    for (const name of ["Next.js", "TypeScript", "Supabase", "TanStack Query", "Vercel", "Jina Reader", "GoCardless", "Fio banka", "Enable Banking", "date-fns"]) {
      expect(found.has(name), name).toBe(true);
    }
  });
});

describe("parsePackageJsonStack", () => {
  it("lists direct runtime dependencies only, sorted", () => {
    const entries = parsePackageJsonStack(JSON.stringify({
      dependencies: { react: "19", next: "16", "@supabase/supabase-js": "2" },
      devDependencies: { vitest: "4" },
    }));
    expect(names(entries!)).toEqual(["@supabase/supabase-js", "next", "react"]);
    expect(entries!.every((entry) => entry.whatItDoes === "")).toBe(true);
  });

  it("returns null for invalid JSON and nothing for a file without dependencies", () => {
    expect(parsePackageJsonStack("{ not json")).toBeNull();
    expect(parsePackageJsonStack("[]")).toBeNull();
    expect(parsePackageJsonStack(JSON.stringify({ name: "x" }))).toEqual([]);
  });
});

describe("mergeDetectedTools", () => {
  const entry = (name: string, whatItDoes = "", specificity = 1): StackEntry => ({ name, key: toolKey(name), whatItDoes, specificity });

  it("merges case-insensitively across projects and keeps each project's note", () => {
    const tools = mergeDetectedTools([
      {
        project: { id: "p1", name: "own-dashboard" },
        source: "about-project",
        entries: [
          entry("Supabase", "Postgres and Auth", 2),
          entry("Supabase", "Postgres database, authentication and RLS", 1),
          entry("recharts", "charts", 4),
        ],
      },
      {
        project: { id: "p2", name: "devShark" },
        source: "about-project",
        entries: [entry("supabase", "Scores and grading"), entry("Recharts", "", 1)],
      },
      { project: { id: "p3", name: "DNESKAi" }, source: "package-json", entries: [entry("next")] },
    ]);
    expect(tools.map((tool) => tool.name)).toEqual(["next", "Recharts", "Supabase"]);
    const supabase = tools.find((tool) => tool.key === "supabase")!;
    expect(supabase.projects).toEqual([
      { id: "p1", name: "own-dashboard", note: "Postgres database, authentication and RLS", source: "about-project" },
      { id: "p2", name: "devShark", note: "Scores and grading", source: "about-project" },
    ]);
    expect(supabase.whatItDoes).toBe("Postgres database, authentication and RLS");
    expect(tools.find((tool) => tool.key === "recharts")!.whatItDoes).toBe("charts");
    expect(tools.find((tool) => tool.key === "next")!.projects[0]!.source).toBe("package-json");
  });

  it("folds accents and spacing into the same key", () => {
    expect(toolKey("  Fio   Banka ")).toBe(toolKey("fio banka"));
    expect(toolKey("Čeština")).toBe("cestina");
  });
});

describe("partitionDetectedTools", () => {
  it("never duplicates a tool the owner added by hand", () => {
    const detected = mergeDetectedTools([
      {
        project: { id: "p1", name: "own-dashboard" },
        source: "about-project",
        entries: [
          { name: "Vercel", key: "vercel", whatItDoes: "Hosting", specificity: 1 },
          { name: "Sentry", key: "sentry", whatItDoes: "Errors", specificity: 1 },
        ],
      },
    ]);
    const manual = [{ id: "t1", name: null, linkTitle: "vercel" }];
    const { unmatched, matches } = partitionDetectedTools(detected, manual, (tool) => [tool.name, tool.linkTitle]);
    expect(unmatched.map((tool) => tool.name)).toEqual(["Sentry"]);
    expect(matches.get(manual[0]!)?.name).toBe("Vercel");
    // An own name that differs from the library title still matches by either.
    const renamed = [{ id: "t2", name: "Sentry", linkTitle: "Sentry — Application monitoring" }];
    expect(partitionDetectedTools(detected, renamed, (tool) => [tool.name, tool.linkTitle]).unmatched.map((tool) => tool.name)).toEqual(["Vercel"]);
  });
});
