# OwnDashboard overhaul continuation handoff

Updated: 2026-07-22

Branch: `codex/higgsfield-media-integration`

Previous implementation pull request: `https://github.com/lukaskourilcz/own-dashboard/pull/56` (merged into `main`).

This is the restart-safe control point for the completed design and architecture overhaul. Start from the branch HEAD, read the files below, and do not repeat completed work or reset the repository.

The follow-up operational implementation is checkpointed at `74120df` and adds the Career table/sorting, subscription grouping/importance/renewal countdowns, a sortable Projects summary with project development links and client communication history, dedicated drag handles, and the Agents VPS task queue. Documentation, fixture, responsive containment, and validation coverage are checkpointed at `d4e4735`. If PR #56 is already merged, continue from `main`; otherwise continue from this branch and preserve both commits.

## Read first

1. `AGENTS.md` — preserve the modified-Next.js warning and read relevant local guides under `node_modules/next/dist/docs/` before framework edits.
2. `CLAUDE.md` — product control surface and definition of done.
3. `docs/design/product-design-audit.md`
4. `docs/design/brand-system.md`
5. `docs/design/design-system.md`
6. `docs/design/visual-qa.md`
7. `docs/design/generated-media-manifest.json`

Use the focused workflows under `.claude/skills/`, especially `own-dashboard-release` and `own-dashboard-visual-qa`, for any follow-up.

## Git safety

These four pre-existing user changes are unrelated to this overhaul and remain intentionally uncommitted:

- `.agents/skills/supabase-postgres-best-practices/CHANGELOG.md`
- `.agents/skills/supabase/CHANGELOG.md`
- `.agents/skills/supabase/SKILL.md`
- `skills-lock.json`

Do not stage, reset, revert, or rewrite them. Do not use `git add -A`. Inspect PR #56 and `git log --oneline` before doing further repository work; this handoff itself may be the final small release commit after the two implementation checkpoints above.

## Completed product work

- Audited the real audience, professional workflows, shell, route-scoped loading, accessibility, responsiveness, repeated UI, and business-risk boundaries.
- Documented directly relevant Refero and Collect UI research without copying branded screens.
- Implemented the “calm operational intelligence” thesis and “operational cartography” visual direction.
- Extended the existing neutral foundation with semantic light/dark surfaces, ink/cobalt structure, status, integration, AI-evidence, chart, focus, density, shape, and motion tokens.
- Added a deterministic name-independent `BrandMark` and applied it to login, shell, metadata, dynamic app icon, manifest, and not-found states.
- Consolidated shared status, entity, metric, and AI-proposal presentation; removed rainbow chart colors, sparkles, mesh gradients, raw enum leakage, and generic SaaS copy.
- Reworked login, sidebar/rail, mobile navigation, command access, Home attention hierarchy, Inbox triage, Work weekly review, Projects, project workspaces, Opportunities, Clients, Career, Invoices, Money, Planning, Library, Settings, contextual AI states, and disconnected states.
- Preserved the catch-all shell, History API, route-scoped React Query loading, own-only RLS, static FX, Czech invoice/VAT/QR behavior, integrations, contextual AI consent/evidence, EN/CS parity, keyboard navigation, PWA behavior, and retired-scope 404s.
- Added an own-scoped, `SECURITY INVOKER`, row-locked, idempotent Inbox routing RPC in `supabase/migrations/20260722150000_atomic_inbox_routing.sql`. It has not been applied to a live database.
- Added `supabase/migrations/20260722190000_operational_workflow_extensions.sql` for canonical subscription classification, `projects.dev_url`, project-owned communication history, and an own-only agent task queue. Its service-role-only claim RPC uses `FOR UPDATE SKIP LOCKED`; it has not been applied to a live database.
- Career listings are a semantic table with a dedicated match column and sorting by match, remote, location, or discovery date.
- Projects are a dense sortable summary table. Text is selectable because dnd-kit listeners now live only on dedicated handles across Projects, Home customization, Notes, and navigation settings.
- Project workspaces include Communication and separate Development/Project site actions.
- Agents queues explicit tasks for trusted VPS workers through authenticated claim/report endpoints; it is not a remote shell.
- Disabled automatic Next.js prefetch on authenticated relationship/deep-workspace links. Explicit navigation is unchanged, while fixture console errors and unnecessary server-seed preloads are avoided.

## Completed engineering and agent architecture

- Added authoritative audit, reference, brand, design-system, deferred-media, visual-QA, migration, rollout, and setup documentation.
- Rewrote `CLAUDE.md`; retained and extended `AGENTS.md`.
- Added five focused skills, four non-overlapping agents, and five executable commands under `.claude/`.
- Added documentation-link integrity tests and expanded Playwright coverage for responsive behavior, axe, auth errors, all canonical destinations, PWA metadata/icons, contextual AI proposals, and invoice print.
- Playwright now performs one optimized local build with one worker. The server-only `NEXT_E2E=1` flag exposes `/dev-preview` only to that local/CI test process; ordinary production builds still return 404.
- Corrected light-mode subtle-text contrast, mobile Quick Add clearance, chart sizing warnings, login callback-alert behavior, and Czech A4 invoice print spacing.

## Validation evidence

Completed successfully at this checkpoint:

- `npm run lint`
- `npx tsc --noEmit`
- `npm run test` — 26 files, 242 tests passed
- `npm run build` — optimized Next.js production build completed
- `npm run test:e2e` — 43 passed, 31 intentional project skips, 0 failed
- axe — login, 17 representative desktop destinations, and the open mobile More dialog had no serious or critical A/AA violations
- responsive runtime — 360, 430, 768, 1024, 1440, and 1728 px, including Czech and dark-mode cases, passed without document overflow
- invoice print — dark-mode Czech invoice parsed as exactly one A4 PDF page and retained white print isolation
- PWA — manifest, dynamic PNG icon, and maskable declaration passed
- all canonical desktop destinations opened without console errors
- Career mobile table containment, project Communication, Agents, and grouped subscription renewal assertions passed
- documentation links, deferred-media JSON, raw-color/enum/retired-scope searches, and `git diff --check` passed

Rerun the exact commands if any code changes after this handoff; never convert discovery or interrupted execution into a pass claim.

## Higgsfield MCP is connected but generation is credit-blocked

The follow-up run connected to the Higgsfield MCP, selected the private Plus workspace, inspected the live model catalog, and completed cost preflights. The MCP billing status reported an active trial with zero remaining trial credits. Recraft and Z Image rejected MCP generation as website-only on the trial; Soul Location returned generation errors. The generation library remained empty. No asset was returned, no substitute generator or placeholder was used, and production code still references no nonexistent media.

After usable paid or trial MCP credits are available, follow `docs/design/higgsfield-art-direction.md` and resume from the exact attempted prompts and request IDs in `docs/design/generated-media-manifest.json` for:

- name-independent brand-symbol exploration and refined favicon/PWA exports;
- login desktop light/dark and mobile stills;
- optional restrained login loop with poster, static, and reduced-motion fallbacks;
- Inbox, Opportunities, Projects, and Clients empty-state family;
- authentic `/dev-preview` README/Open Graph composition;
- optional disconnected-integration, limited-context AI, and project-header treatments, accepted only if they add real value.

## External work that still requires owner systems

- Apply all four pending Supabase migrations, including `20260722190000_operational_workflow_extensions.sql`, through the repository's normal reviewed migration workflow.
- Configure `AGENT_RUNNER_TOKEN` and `DASHBOARD_OWNER_ID` only if the VPS queue should be consumed; validate with a disposable task first.
- Exercise OAuth, GitHub, Google Calendar, GoCardless, Resend, PostHog, Sentry, and Anthropic against real configured provider accounts.
- Add usable Higgsfield MCP generation credits, then generate and approve only the manifest's high-value media; MCP connectivity alone has already been verified.

These are external-state tasks, not unfinished repository implementation.

## Non-negotiable rules

Keep the product name centralized in `src/lib/brand.ts`. Tugedr is an opportunity source, never Pulse. Never restore habits, streaks, books, couple, mood, or lifestyle scope. Preserve own-only RLS, foreign-record ownership checks, service-role boundaries, route-scoped data, static FX, invoice correctness, AI consent/evidence validation, authentic `/dev-preview` screenshots, bilingual parity, and accessible responsive behavior. Do not add team/SaaS scope, a global chatbot, generated fake UI, or filler media.
