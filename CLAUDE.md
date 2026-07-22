@AGENTS.md

# OwnDashboard control document

OwnDashboard is a bilingual, self-hosted, own-only professional operating system for one software engineer/freelancer. It connects projects, client opportunities, organizations, VPS agent tasks, Career, Czech invoices, money, planning, knowledge, integrations, notifications, weekly reviews, and contextual AI. Tugedr is a client-opportunity source. Pulse, habits/streaks, books/reading, couples, partner data, and general lifestyle tracking are retired and must not return. Keep the temporary name OwnDashboard centralized in `src/lib/brand.ts`; never rename it to Takt.

## Read before changing

- Product and architecture: `README.md`, `DOCS.md`, `docs/ai-and-privacy.md`, `docs/migration-guide.md`
- Design: `docs/design/product-design-audit.md`, `docs/design/brand-system.md`, `docs/design/design-system.md`
- Modified Next.js: `AGENTS.md` and the relevant local guide in `node_modules/next/dist/docs/`
- External/PWA rollout: `docs/external-setup.md`, `NEEDED.md`

## Non-negotiable architecture

`src/app/[[...slug]]/page.tsx` is the authenticated, route-scoped server boundary; `src/components/dashboard-shell.tsx` is the persistent History API shell. Keep the canonical navigation model, `dashboardDataKeysForTab`, centralized query keys, `useEntityStore`, lazy destination fetchers, bounded results, invalidation, and project workspaces at `/projects/[id-or-slug]`. Preserve own-only RLS and related-foreign-record ownership, authenticated service-role boundaries, static FX, project/cron costs, invoice/VAT/QR/print correctness, direct Google Calendar behavior, GitHub/bank boundaries, legacy export, and contextual AI consent/bounded context/source validation/separate writes.

Agents is a durable task queue, never a browser remote shell. Keep `AGENT_RUNNER_TOKEN` and the service role server-only, constrain workers to `DASHBOARD_OWNER_ID`, require stable agent identity, and preserve atomic `FOR UPDATE SKIP LOCKED` claims. Project communications stay owned and project-scoped. Subscription operational groups and importance are canonical; renewal dates remain explicit rather than inferred from live billing providers.

## Product and design rules

Design for “calm operational intelligence” through operational cartography: connected records, clear signals, aligned dense rows, border hierarchy, warm neutral/graphite surfaces, deep ink/cobalt structure, and amber attention. Search before creating; reuse semantic tokens and shared components; never add filler media, fake UI, glass, glow, generic gradients, decorative sparkles/metrics, nested-card walls, or a second icon system. Keep Geist, tabular figures, restrained motion, reduced-motion support, and EN/CS parity. Validate long content, non-happy paths, mobile widths, keyboard flow, and WCAG 2.2 AA behavior.

Higgsfield is optional and generated media is currently credit-blocked. MCP presence is not sufficient: check workspace selection, balance, billing/trial status, and a cost-only preflight before production. When the MCP is unavailable or has no usable credits, do not wait, substitute another generator, or add fake placeholders. Preserve documented media seams and authentic `/dev-preview` screenshots; resume from the recorded prompts and request evidence in the media manifest.

## Project workflows

Use these local skills when applicable:

- `.claude/skills/own-dashboard-product/SKILL.md`
- `.claude/skills/own-dashboard-design-system/SKILL.md`
- `.claude/skills/own-dashboard-higgsfield/SKILL.md`
- `.claude/skills/own-dashboard-visual-qa/SKILL.md`
- `.claude/skills/own-dashboard-release/SKILL.md`

Narrow agents live in `.claude/agents/`; executable command playbooks live in `.claude/commands/`.

## Validation and Git

Run `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`, and `npm run test:e2e`; use `/dev-preview` for deterministic visual/axe checks. Report exact results only. During large work, inspect Git first, preserve unrelated changes, create coherent imperative commits, and never push unless explicitly requested. Definition of done includes business logic, RLS/privacy, responsive/a11y states, localization, tests/build, docs, media provenance/deferment, and a known clean implementation state.
