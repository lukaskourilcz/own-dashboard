@AGENTS.md

# OwnDashboard control document

OwnDashboard is a bilingual, self-hosted, own-only professional operating system for one software engineer/freelancer. It connects projects, client opportunities, organizations, VPS agent tasks, Career, Czech invoices, money, planning, knowledge, integrations, notifications, weekly reviews, and contextual AI. Tugedr is a client-opportunity source. Pulse, lifestyle habits/streaks, books/reading, couples, partner data, and general lifestyle tracking are retired and must not return. The Home completion garden is professional seven-task execution history backed by `daily_focus_*`; it must never reuse or restore the retired personal `streaks` model. Keep the temporary name OwnDashboard centralized in `src/lib/brand.ts`; never rename it to Takt.

## Read before changing

- Product and architecture: `README.md`, `DOCS.md`, `docs/ai-and-privacy.md`, `docs/migration-guide.md`
- Design: `docs/design/product-design-audit.md`, `docs/design/brand-system.md`, `docs/design/design-system.md`
- Modified Next.js: `AGENTS.md` and the relevant local guide in `node_modules/next/dist/docs/`
- External/PWA rollout: `docs/external-setup.md`, `NEEDED.md`

## Non-negotiable architecture

`src/app/[[...slug]]/page.tsx` is the authenticated, route-scoped server boundary; `src/components/dashboard-shell.tsx` is the persistent History API shell. Keep the canonical navigation model, `dashboardDataKeysForTab`, centralized query keys, `useEntityStore`, lazy destination fetchers, bounded results, invalidation, and project workspaces at `/projects/[id-or-slug]`. Preserve own-only RLS and related-foreign-record ownership, authenticated service-role boundaries, static FX, project/cron costs, invoice/VAT/QR/print correctness, direct Google Calendar behavior, GitHub/bank boundaries, legacy export, and contextual AI consent/bounded context/source validation/separate writes.

Project communications stay owned and project-scoped. Subscription operational groups and importance are canonical; renewal dates remain explicit rather than inferred from live billing providers.

## Product and design rules

Design for “calm operational intelligence” through the approved macOS-native operational-cartography system: a graphite desktop, an app window inset 20 px vertically and 30 px horizontally, 224 px translucent dark sidebar, 52 px toolbar, compact white modules, system UI typography, tabular figures, and restrained semantic macOS accents. Desktop window chrome is an OwnDashboard presentation device, not an Apple mark. Search before creating; reuse semantic tokens and shared components; never add filler media, fake UI, glow, generic decorative gradients, sparkles/metrics, nested-card walls, or a second icon system. Gradients are limited to the graphite desktop, primary control, and avatar treatment. Preserve restrained motion, reduced-motion support, and EN/CS parity. Validate long content, non-happy paths, mobile widths, keyboard flow, and WCAG 2.2 AA behavior.

Brand-media production starts with current primary provider research for at least three low-cost or free generators. Compare real cost/free quota, output rights, watermark, privacy/retention, formats, quality fit, and credential requirements. Select and document the safest viable provider, but do not register, purchase, expose credentials, or upload private data without owner authorization. Preserve authentic `/dev-preview` screenshots, never generate UI, and leave media deferred without placeholders if no provider qualifies.

## Project workflows

Use these local skills when applicable:

- `.claude/skills/own-dashboard-product/SKILL.md`
- `.claude/skills/own-dashboard-design-system/SKILL.md`
- `.claude/skills/own-dashboard-brand-media/SKILL.md`
- `.claude/skills/own-dashboard-visual-qa/SKILL.md`
- `.claude/skills/own-dashboard-release/SKILL.md`

Narrow agents live in `.claude/agents/`; executable command playbooks live in `.claude/commands/`.

## Shared skills

Four skills in `.claude/skills/` are vendored verbatim from upstream and kept
identical across every repository. Each carries an `UPSTREAM.md` with its
source, pinned commit, and license — re-vendor rather than hand-editing them.

- **`task-observer`** — invoke at the **start of every task-oriented session**,
  before producing deliverables. It records corrections and workflow friction in
  an observation log so they can become skill improvements later. Its log lives
  outside the repo; `.claude/observations/` is git-ignored.
- **`stop-slop`** — apply to every piece of prose that ships: documentation,
  `NEEDED.md` entries, UI copy, commit bodies, and pull-request descriptions.
- **`ui-ux-pro-max`** — consult before visual or interaction decisions. Query
  the bundled database with
  `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>`
  (domains: `ux`, `style`, `color`, `typography`, `product`, `chart`, `gsap`).
  It is generic advice. **This repository's own design contract always wins**
  where the two disagree — never let a generic recommendation override a
  documented product invariant.
- **`find-skills`** — use when a capability might already exist as an
  installable skill instead of hand-rolling one. Its `npx skills` commands need
  network access; fall back to working directly when that is unavailable.

## Validation and Git

Run `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`, and `npm run test:e2e`; use `/dev-preview` for deterministic visual/axe checks. Report exact results only. During large work, inspect Git first, preserve unrelated changes, create coherent imperative commits, and never push unless explicitly requested. Definition of done includes business logic, RLS/privacy, responsive/a11y states, localization, tests/build, docs, media provenance/deferment, and a known clean implementation state.
