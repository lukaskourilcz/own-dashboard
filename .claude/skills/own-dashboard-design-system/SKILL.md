---
name: own-dashboard-design-system
description: Design, implement, or review OwnDashboard UI, shared components, status presentation, responsive behavior, copy, charts, tables, forms, motion, or accessibility. Use whenever a screen or visual pattern changes in authenticated, login, PWA, invoice-adjacent, empty, error, or AI proposal surfaces.
---

# OwnDashboard design system

1. Read `docs/design/brand-system.md`, `docs/design/design-system.md`, and the target workflow. Inspect `src/app/globals.css` and `src/components/ui/` before adding values or components.
2. Apply “calm operational intelligence” and “operational cartography”: alignment, section lines, connected entities, clear signals, and medium-high density. Preserve paper/stone and graphite neutrals, deep ink/cobalt structure, amber attention, and restrained semantic green/red.
3. Use semantic CSS variables. Do not scatter raw colors, arbitrary radii/shadows, gradient decoration, glows, glass, oversized cards, nested cards, decorative metrics, pills everywhere, or sparkles for AI.
4. Use Geist Sans, Geist Mono for technical values, tabular figures for money/dates/counts, modest headings, modest radii, border hierarchy, and elevation only for floating surfaces.
5. Prefer dense comparable rows/tables for transactions, invoices, listings, and references; cards only for summaries or self-contained workflows; lanes only when movement between stages is central.
6. Reuse `PageHeader`, `Card`, `Button`, `EmptyState`, `StatusBadge`, `EntityBadge`, `Metric`, `AiProposalPanel`, dialogs, selects, and existing domain components. Create an abstraction only after finding at least two real consumers.
7. Localize internal enums through `src/lib/status-presentation.ts` or domain dictionaries. Pair color with text/marker/icon.
8. Preserve focus rings, landmarks, labels, error associations, keyboard access, dialog focus/Escape, table semantics, reduced motion, reflow, 44px mobile actions, and accessible generated-media classification.
9. Define transformations at 360, 430, 768, 1024, 1440, and 1728 px. Keep critical data reachable; make workspace tabs scroll, stack filters/details, and provide touch equivalents.
10. Validate both themes, EN/CS, long labels/names/values, loading/empty/error/disabled states, keyboard behavior, axe, overflow, and authentic `/dev-preview` rendering.
