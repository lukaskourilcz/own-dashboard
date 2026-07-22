---
name: own-dashboard-product
description: Implement or review OwnDashboard product workflows, navigation, domain behavior, Supabase relationships, contextual AI, invoices, integrations, or route-scoped data loading. Use for any change that can affect professional entities, owner privacy, Tugedr opportunities, project workspaces, financial calculations, exports, or retired personal scope.
---

# OwnDashboard product

1. Read `AGENTS.md`, `README.md`, `DOCS.md`, and `docs/design/product-design-audit.md`. For framework work, read the relevant guide under `node_modules/next/dist/docs/` before editing.
2. Trace the real workflow through `src/app/[[...slug]]/page.tsx`, `src/components/dashboard-shell.tsx`, the destination panel, query keys/fetchers, types, API routes, migrations, and tests. Distinguish evidence from assumptions.
3. Preserve the catch-all shell, History API navigation, route-scoped server seeds, `dashboardDataKeysForTab`, lazy queries, bounded results, invalidation, and `/projects/[id-or-slug]` as the supported nested workspace.
4. Preserve own-only RLS and foreign-entity ownership checks. Browser writes never justify a weaker policy. Service-role use stays server-side and follows an authenticated owner check.
5. Preserve static FX, project cost/cron estimates, Czech invoice math/VAT/QR/print, OAuth boundaries, deterministic PDF extraction, AI consent, bounded context, source validation, and separate write confirmation.
6. Use the implemented information architecture. Tugedr is an opportunity source. Never restore Pulse, habits, streaks, books, couples, partner data, lifestyle tracking, multi-tenancy, billing, a global chatbot, or live FX. Never rename OwnDashboard without explicit approval.
7. Reuse existing state, forms, primitives, and canonical entities; search before creating. Do not duplicate task, note, invoice, project, opportunity, or integration storage for a screen-specific convenience.
8. Cover loading, initial/filtered empty, error, disconnected, disabled, permission, reauthorization, success, destructive, archived, long-content, translated, and mobile states in proportion to the workflow.
9. Update EN and CS dictionaries together. Use direct, factual language and human-readable status labels.
10. Add or update focused tests; run `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`, and relevant Playwright checks. Record exact results, including pre-existing failures.
