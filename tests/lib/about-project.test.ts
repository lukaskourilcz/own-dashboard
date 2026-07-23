import { describe, expect, it } from "vitest";
import { parseAboutProject } from "@/lib/about-project";

describe("about-project knowledge", () => {
  it("extracts summary, tech stack, and described libraries", () => {
    const parsed = parseAboutProject(`# OwnDashboard

A private professional operating system.

## Tech stack

- Next.js — application shell and server routes
- \`Supabase\`: owned Postgres data and authentication

## Third-party libraries

- TanStack Query — bounded client cache
- Motion - restrained interaction feedback
`);

    expect(parsed.summary).toContain("A private professional operating system");
    expect(parsed.techStack).toEqual([
      { name: "Next.js", description: "application shell and server routes" },
      { name: "Supabase", description: "owned Postgres data and authentication" },
    ]);
    expect(parsed.libraries).toEqual([
      { name: "TanStack Query", description: "bounded client cache" },
      { name: "Motion", description: "restrained interaction feedback" },
    ]);
  });

  it("does not treat unrelated bullet lists as dependencies", () => {
    const parsed = parseAboutProject(`## Product goals
- Keep invoices correct

## Technologie
- TypeScript

## Knihovny
- date-fns — date formatting
`);

    expect(parsed.techStack).toEqual([{ name: "TypeScript", description: "" }]);
    expect(parsed.libraries).toEqual([
      { name: "date-fns", description: "date formatting" },
    ]);
  });
});
