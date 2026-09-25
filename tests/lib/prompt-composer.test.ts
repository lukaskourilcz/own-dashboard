import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  composePromptCopy,
  expandPromptPlaceholders,
  linksToConsult,
  PROMPT_PLACEHOLDERS,
  type ComposerLink,
} from "@/lib/prompt-composer";
import {
  PROMPT_KINDS,
  categoryMatchesKind,
  groupPromptsByKind,
  isPromptKind,
  promptKind,
} from "@/lib/prompt-kinds";
import {
  planPromptLinkSync,
  projectComposerLinks,
  promptComposerLinks,
  promptLinkDrafts,
  suggestedLinkIds,
} from "@/lib/prompt-links";
import type { AiCategory, AiLink, ProjectLink, PromptLink } from "@/lib/types";

const dneskai = {
  name: "DNESKAi",
  repo_full_name: "lukaskourilcz/aifirst",
  url: "https://dneska.example",
  dev_url: null,
};

const link = (id: string, title: string, category: string | null, note = ""): ComposerLink => ({
  id,
  title,
  url: `https://example.com/${id}`,
  note,
  category,
});

describe("prompt kinds", () => {
  it("keeps the fixed order with other last and treats unknown kinds as other", () => {
    expect(PROMPT_KINDS).toEqual(["design", "audit", "competition", "ux-ui", "analysis", "documentation", "new-project", "seo", "marketing", "other"]);
    expect(isPromptKind("seo")).toBe(true);
    expect(isPromptKind("SEO")).toBe(false);
    expect(promptKind({})).toBe("other");
  });

  it("groups by kind in order and hides empty kinds", () => {
    const groups = groupPromptsByKind([{ kind: "seo" as const }, { kind: undefined }, { kind: "design" as const }, { kind: "seo" as const }]);
    expect(groups.map((group) => [group.kind, group.prompts.length])).toEqual([["design", 1], ["seo", 2], ["other", 1]]);
  });

  it("matches library categories by whole word, in English or Czech", () => {
    expect(categoryMatchesKind("SEO", "seo")).toBe(true);
    expect(categoryMatchesKind("SEO & search tools", "seo")).toBe(true);
    expect(categoryMatchesKind("Vyhledávání", "seo")).toBe(true);
    expect(categoryMatchesKind("HOSTING", "seo")).toBe(false);
    expect(categoryMatchesKind("Linux", "ux-ui")).toBe(false);
    expect(categoryMatchesKind(null, "seo")).toBe(false);
    expect(categoryMatchesKind("anything", "other")).toBe(false);
  });
});

describe("composePromptCopy", () => {
  const body = "Check {{project.name}} at {{project.url}} ({{ project.repo }}, dev {{project.dev_url}}).";

  it("expands the four placeholders and marks missing values", () => {
    expect(expandPromptPlaceholders(body, dneskai)).toBe(
      "Check DNESKAi at https://dneska.example (lukaskourilcz/aifirst, dev —).",
    );
    expect(PROMPT_PLACEHOLDERS).toHaveLength(4);
  });

  it("leaves placeholders and omits the Project block without a project", () => {
    const text = composePromptCopy({
      body,
      kind: "seo",
      project: null,
      promptLinks: [],
      projectLinks: [link("vercel", "Vercel", "HOSTING")],
    });
    expect(text).toBe(body);
    expect(text).not.toContain("## Project");
    expect(text).not.toContain("Vercel");
  });

  it("copies an SEO prompt with the project block and the project's SEO links", () => {
    const text = composePromptCopy({
      body: "Run an SEO check of {{project.name}}.",
      kind: "seo",
      project: dneskai,
      promptLinks: [link("pagespeed", "PageSpeed Insights", "SEO", "Run it on Today first")],
      projectLinks: [
        link("search-console", "Google Search Console", "SEO", "Indexing of daily editions"),
        link("pagespeed", "PageSpeed Insights", "SEO", "Core Web Vitals"),
        link("vercel", "Vercel", "HOSTING", "Hosts the site"),
      ],
    });
    expect(text).toBe(
      [
        "Run an SEO check of DNESKAi.",
        "",
        "## Project",
        "DNESKAi, lukaskourilcz/aifirst, https://dneska.example",
        "",
        "## Links to consult",
        "- PageSpeed Insights — https://example.com/pagespeed — Run it on Today first",
        "- Google Search Console — https://example.com/search-console — Indexing of daily editions",
      ].join("\n"),
    );
  });

  it("uses all of the project's links when the prompt has none of its own", () => {
    const links = linksToConsult({
      kind: "seo",
      promptLinks: [],
      projectLinks: [link("vercel", "Vercel", "HOSTING"), link("sc", "Search Console", "SEO")],
    });
    expect(links.map((item) => item.title)).toEqual(["Vercel", "Search Console"]);
  });

  it("keeps the prompt's links without a project and drops an empty note", () => {
    const text = composePromptCopy({
      body: "Audit {{project.name}}.",
      kind: "audit",
      project: null,
      promptLinks: [link("hibp", "Have I Been Pwned", "SECURITY")],
    });
    expect(text).toBe("Audit {{project.name}}.\n\n## Links to consult\n- Have I Been Pwned — https://example.com/hibp");
  });
});

describe("prompt links", () => {
  const TS = "2026-09-25T10:00:00Z";
  const categories: AiCategory[] = [
    { id: "c-seo", user_id: "owner", name: "SEO", sort_order: 1, created_at: TS },
    { id: "c-host", user_id: "owner", name: "HOSTING", sort_order: 2, created_at: TS },
  ];
  const aiLinks: AiLink[] = [
    { id: "sc", user_id: "owner", category_id: "c-seo", title: "Search Console", url: "https://sc.example", description: null, pricing: "free", created_at: TS, updated_at: TS },
    { id: "ps", user_id: "owner", category_id: "c-seo", title: "PageSpeed", url: "https://ps.example", description: null, pricing: "free", created_at: TS, updated_at: TS },
    { id: "vercel", user_id: "owner", category_id: "c-host", title: "Vercel", url: "https://vercel.example", description: null, pricing: "freemium", created_at: TS, updated_at: TS },
    { id: "idea", user_id: "owner", category_id: "c-seo", record_type: "idea", title: "Idea", url: "https://idea.example", description: null, pricing: null, created_at: TS, updated_at: TS },
  ];
  const promptLinks: PromptLink[] = [
    { id: "a", user_id: "owner", prompt_id: "p1", ai_link_id: "ps", note: "Today first", sort_order: 1, created_at: TS, updated_at: TS },
    { id: "b", user_id: "owner", prompt_id: "p1", ai_link_id: "sc", note: "", sort_order: 0, created_at: TS, updated_at: TS },
    { id: "c", user_id: "owner", prompt_id: "p1", ai_link_id: "gone", note: "", sort_order: 2, created_at: TS, updated_at: TS },
  ];
  const projectLinks: ProjectLink[] = [
    { id: "r1", user_id: "owner", project_id: "proj", ai_link_id: "vercel", role: "tool", note: "Hosts", sort_order: 0, created_at: TS, updated_at: TS },
  ];

  it("builds ordered composer links with category names and skips deleted links", () => {
    expect(promptLinkDrafts("p1", promptLinks, aiLinks)).toEqual([
      { ai_link_id: "sc", note: "" },
      { ai_link_id: "ps", note: "Today first" },
    ]);
    expect(promptComposerLinks("p1", promptLinks, aiLinks, categories).map((item) => [item.title, item.category])).toEqual([
      ["Search Console", "SEO"],
      ["PageSpeed", "SEO"],
    ]);
    expect(projectComposerLinks("proj", projectLinks, aiLinks, categories)).toEqual([
      { id: "vercel", title: "Vercel", url: "https://vercel.example", note: "Hosts", category: "HOSTING" },
    ]);
  });

  it("plans the writes that make stored links match the editor", () => {
    const plan = planPromptLinkSync("p1", promptLinks, [
      { ai_link_id: "sc", note: "" },
      { ai_link_id: "vercel", note: " deploy logs " },
    ]);
    expect(plan.removeIds.sort()).toEqual(["a", "c"]);
    expect(plan.upserts).toEqual([{ ai_link_id: "vercel", note: "deploy logs", sort_order: 1 }]);
  });

  it("suggests library links (never ideas) from matching categories", () => {
    expect(suggestedLinkIds(aiLinks, categories, (name) => categoryMatchesKind(name, "seo"), new Set(["ps"]))).toEqual(["sc"]);
  });
});

describe("prompt kinds migration", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260925090400_prompt_kinds_and_links.sql", import.meta.url), "utf8");

  it("constrains kind to the same list the app uses", () => {
    const listed = [...(sql.match(/check \(kind in \(([\s\S]+?)\)\)/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(listed).toEqual([...PROMPT_KINDS]);
    expect(sql).toMatch(/kind text not null default 'other'/);
  });

  it("keeps prompt_links own-only with both parents checked", () => {
    expect(sql).toMatch(/prompt_links enable row level security/);
    expect(sql).toMatch(/unique \(prompt_id, ai_link_id\)/);
    expect(sql.match(/from public\.prompts pr where pr\.id = prompt_id and pr\.user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(2);
    expect(sql.match(/from public\.ai_links l where l\.id = ai_link_id and l\.user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(2);
  });
});
