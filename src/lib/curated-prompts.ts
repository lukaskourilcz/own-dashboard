import type { PromptKind } from "@/lib/prompt-kinds";

/**
 * Curated, universal prompts: one or two for each kind of job. They are not
 * the owner's own prompts; "Add curated prompts" inserts them as the owner's
 * rows flagged `is_public`, de-duplicated by name so a repeat click never
 * creates copies. Edit or delete them like any prompt.
 *
 * Each body uses the project placeholders the copy action expands —
 * {{project.name}}, {{project.repo}}, {{project.url}}, {{project.dev_url}} —
 * and relies on the "Links to consult" block the copy action appends.
 * `suggestedCategories` are library category words used to pre-select links
 * in the editor's link picker.
 */
export type CuratedPrompt = {
  name: string;
  kind: Exclude<PromptKind, "other">;
  description: string;
  body: string;
  suggestedCategories: string[];
};

export const CURATED_PROMPTS: CuratedPrompt[] = [
  {
    name: "Design direction",
    kind: "design",
    description: "Propose a visual direction for a project, grounded in its audience and the linked references.",
    suggestedCategories: ["design", "fonts", "colors", "icons", "inspiration"],
    body: `You are a product designer working on {{project.name}} ({{project.url}}). The code is in {{project.repo}}.

1. Read the repository's design documents and the live site. Summarise who the product serves and what it must feel like, in five bullet points.
2. Open every link under "Links to consult" and note which fonts, colours, icon sets or references fit that brief and why.
3. Propose one visual direction: typography scale, colour tokens with contrast ratios, spacing, radius and elevation rules, and two component examples.
4. List what to change first, in order, with the files you would touch.

Keep existing brand rules unless you say exactly why one should change. Do not invent screenshots or UI that does not exist.`,
  },
  {
    name: "Design review of one screen",
    kind: "design",
    description: "Critique one screen against the project's own design system and the linked references.",
    suggestedCategories: ["design", "ui", "inspiration"],
    body: `Review one screen of {{project.name}} (development build: {{project.dev_url}}).

Screen: [route or screenshot]

Compare it with the project's design system in {{project.repo}} and with the references under "Links to consult". Report hierarchy, alignment, spacing, typography, colour and state problems, each with the exact element, why it matters and a concrete fix. Rank the findings by user impact. Say "none" for areas that are fine rather than padding the list.`,
  },
  {
    name: "Project audit",
    kind: "audit",
    description: "Audit security, performance, accessibility and maintainability with ranked, evidenced findings.",
    suggestedCategories: ["security", "performance", "accessibility", "testing", "monitoring"],
    body: `Audit {{project.name}}. Repository: {{project.repo}}. Production: {{project.url}}.

Cover security (auth, secrets, input handling, dependency risk), performance (bundle size, slow queries, caching), accessibility (WCAG 2.2 AA) and maintainability (tests, duplication, dead code). Use the tools under "Links to consult" where they apply and cite what each one reported.

For every finding give: area, severity (blocker / major / minor), evidence (file and line, or tool output), and the smallest fix. Separate verified findings from suspicions. Finish with the five changes that remove the most risk.`,
  },
  {
    name: "Pre-release check",
    kind: "audit",
    description: "Go/no-go checklist before shipping, with the exact commands and results.",
    suggestedCategories: ["testing", "monitoring", "hosting", "security"],
    body: `Prepare a go/no-go release check for {{project.name}} ({{project.repo}}).

Run or list the project's own validation commands (lint, type check, unit tests, build, end-to-end tests) and report each exact result. Check migrations, environment variables, error monitoring and rollback steps. Use the services under "Links to consult" to confirm hosting and monitoring are configured.

Answer with GO or NO-GO first, then the blockers, then everything that passed. Never report a check as passing unless it ran.`,
  },
  {
    name: "Competitor scan",
    kind: "competition",
    description: "Map direct and indirect competitors and where the project can win.",
    suggestedCategories: ["competition", "market", "research", "ideas"],
    body: `Research the competition for {{project.name}} ({{project.url}}).

1. From the site and repository README, state the product's audience and core promise in two sentences.
2. Find five direct and five indirect alternatives. Start from the links under "Links to consult"; add others only with a source URL.
3. For each: audience, pricing, strongest feature, visible weakness, and the evidence URL.
4. Say where {{project.name}} can realistically win and what it should not try to match.

Mark anything you could not verify. Do not estimate market sizes without a cited source.`,
  },
  {
    name: "UX and UI review",
    kind: "ux-ui",
    description: "Walk the main user flow and report usability and accessibility problems.",
    suggestedCategories: ["ux", "ui", "accessibility", "design"],
    body: `Walk through the main user flow of {{project.name}} on {{project.dev_url}} (production: {{project.url}}).

Flow: [describe the task a user is trying to finish]

At 360, 768 and 1280 px, and with the keyboard only, report where the user hesitates, loses context or cannot continue. Check empty, loading, error and long-content states, focus order, target sizes, contrast and reduced motion. Use the guidelines under "Links to consult".

For each problem: step, what happens, why it hurts, and a concrete fix. Rank by how many users it blocks.`,
  },
  {
    name: "Project analysis",
    kind: "analysis",
    description: "Explain how the project works, where it is fragile and what to improve first.",
    suggestedCategories: ["analytics", "data", "performance", "research"],
    body: `Analyse {{project.name}} from its repository {{project.repo}}.

Describe the architecture in ten lines or fewer: entry points, data flow, storage, external services and scheduled jobs. Then list the three most fragile areas with evidence (files, missing tests, complex modules) and the three cheapest improvements with the biggest effect. Use the analytics and monitoring links under "Links to consult" for real usage or error data, and say when you had none.`,
  },
  {
    name: "Documentation pass",
    kind: "documentation",
    description: "Bring README and docs in line with the code, removing what is stale.",
    suggestedCategories: ["documentation", "docs", "writing"],
    body: `Update the documentation of {{project.name}} ({{project.repo}}) to match the code as it is today.

1. List every statement in README and docs that the code contradicts, with file and line.
2. Rewrite those passages: plain sentences, exact commands, no marketing language.
3. Add what a new contributor needs and cannot find: setup, environment variables, test commands, deployment and the URLs {{project.url}} and {{project.dev_url}}.
4. Check every relative link resolves.

Follow the writing guides under "Links to consult". Return the changes as a diff.`,
  },
  {
    name: "New project from an idea",
    kind: "new-project",
    description: "Turn an idea into a scoped first version with stack, data model and a build plan.",
    suggestedCategories: ["ideas", "starter", "hosting", "database", "templates"],
    body: `Turn this idea into a first version I can build.

Idea: [one paragraph]

1. Restate the problem, the user and the one job the first version must do.
2. Pick a stack, preferring the services under "Links to consult"; say why each fits and what it costs at small scale.
3. Sketch the data model and the three main screens.
4. Write a build plan as ordered, testable steps, each small enough for one working session.
5. List what is out of scope for the first version.

If it becomes a project like {{project.name}}, reuse its conventions from {{project.repo}}.`,
  },
  {
    name: "SEO check",
    kind: "seo",
    description: "Check indexing, metadata, structured data and Core Web Vitals, with fixes.",
    suggestedCategories: ["seo", "search", "performance"],
    body: `Run an SEO check of {{project.name}} at {{project.url}}. The code is in {{project.repo}}.

Check indexing and sitemap, robots rules, titles and descriptions, canonical and hreflang tags, structured data, internal links, image alt text and Core Web Vitals. Use the tools under "Links to consult" and quote what each reported.

Report each issue with the affected URLs, the evidence and the fix in code. Rank by expected search impact. Do not promise rankings or traffic numbers.`,
  },
  {
    name: "Marketing plan",
    kind: "marketing",
    description: "A four-week plan with channels, messages and measurable goals.",
    suggestedCategories: ["marketing", "social", "email", "seo"],
    body: `Draft a four-week marketing plan for {{project.name}} ({{project.url}}).

1. State the audience and the one message that should reach them.
2. Choose at most three channels, preferring the services under "Links to consult", and say why each fits.
3. For each week: what to publish, where, and the measurable goal.
4. Name the metric that decides whether to continue after four weeks.

Use only claims the product can support today. No paid spend unless I approve it.`,
  },
  {
    name: "Launch announcement",
    kind: "marketing",
    description: "Write a short, factual launch post adapted to each channel.",
    suggestedCategories: ["marketing", "social", "writing"],
    body: `Write a launch announcement for {{project.name}} ({{project.url}}).

What changed: [release notes or summary]

Produce one version per channel from "Links to consult" (for example a changelog entry, a LinkedIn post and a short post), each within that channel's usual length. Lead with what the user can now do, not with the technology. Keep every claim checkable against the release notes.`,
  },
];
