# OwnDashboard overhaul continuation handoff

Updated: 2026-07-22

Branch: `agent/own-dashboard-design-overhaul`

This is the restart-safe control point for the completed design and architecture overhaul. Start from the branch HEAD, read the files below, and do not repeat completed work or reset the repository.

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

Do not stage, reset, revert, or rewrite them. Do not use `git add -A`. The commit containing this handoff is the current branch HEAD; inspect `git log --oneline origin/main..HEAD` for immutable hashes after checkout.

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
- `npm run test` — 26 files, 241 tests passed
- `npm run build` — optimized Next.js production build completed
- `npm run test:e2e` — 37 passed, 25 intentional project skips, 0 failed
- axe — login, 14 representative desktop destinations, and the open mobile More dialog had no serious or critical A/AA violations
- responsive runtime — 360, 430, 768, 1024, 1440, and 1728 px, including Czech and dark-mode cases, passed without document overflow
- invoice print — dark-mode Czech invoice parsed as exactly one A4 PDF page and retained white print isolation
- PWA — manifest, dynamic PNG icon, and maskable declaration passed
- all canonical desktop destinations opened without console errors
- documentation links, deferred-media JSON, raw-color/enum/retired-scope searches, and `git diff --check` passed

Rerun the exact commands if any code changes after this handoff; never convert discovery or interrupted execution into a pass claim.

## Higgsfield remains deferred

Higgsfield was unavailable by explicit instruction. No research attempts, substitute generator, placeholder art, fake UI, or nonexistent production references were added. Integration seams and provenance fields are ready.

When the actual Higgsfield MCP becomes available, follow `docs/design/higgsfield-art-direction.md` and `docs/design/generated-media-manifest.json` for:

- name-independent brand-symbol exploration and refined favicon/PWA exports;
- login desktop light/dark and mobile stills;
- optional restrained login loop with poster, static, and reduced-motion fallbacks;
- Inbox, Opportunities, Projects, and Clients empty-state family;
- authentic `/dev-preview` README/Open Graph composition;
- optional disconnected-integration, limited-context AI, and project-header treatments, accepted only if they add real value.

## External work that still requires owner systems

- Apply the new Supabase migration through the repository's normal reviewed migration workflow.
- Exercise OAuth, GitHub, Google Calendar, GoCardless, Resend, PostHog, Sentry, and Anthropic against real configured provider accounts.
- Generate and approve Higgsfield media only after the real MCP is installed.

These are external-state tasks, not unfinished repository implementation.

## Non-negotiable rules

Keep the product name centralized in `src/lib/brand.ts`. Tugedr is an opportunity source, never Pulse. Never restore habits, streaks, books, couple, mood, or lifestyle scope. Preserve own-only RLS, foreign-record ownership checks, service-role boundaries, route-scoped data, static FX, invoice correctness, AI consent/evidence validation, authentic `/dev-preview` screenshots, bilingual parity, and accessible responsive behavior. Do not add team/SaaS scope, a global chatbot, generated fake UI, or filler media.
