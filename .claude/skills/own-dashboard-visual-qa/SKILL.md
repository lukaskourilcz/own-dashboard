---
name: own-dashboard-visual-qa
description: Run evidence-based visual, responsive, interaction, localization, accessibility, and generated-media QA for OwnDashboard. Use after UI changes, before release, or when investigating overflow, navigation, dialog, table, invoice print, PWA, theme, long-content, mobile, or WCAG issues.
---

# OwnDashboard visual QA

1. Read `docs/design/design-system.md`, `docs/design/brand-system.md`, `e2e/helpers.ts`, and the target tests. Use deterministic `/dev-preview`; never use private data in screenshots.
2. Start or reuse the local app. Inspect login, Home, Inbox, Work, Projects, a project workspace, Opportunities, Clients, Career, Invoices, Money, Tasks, Calendar, Notes, Settings, not-found, and relevant dialogs/states.
3. Exercise 360, 430, 768, 1024, 1440, and 1728 px. Check navigation hierarchy, safe areas, overflow, sticky surfaces, scrollable tabs, filters, tables, charts, forms, drawers/dialogs, long Czech copy, long names, and large currency values.
4. Check light/dark, EN/CS, reduced motion, loading, initial/filtered empty, error, disconnected, disabled, archived, permission, and reauthorization states.
5. Run axe and manual keyboard checks: skip link, visible focus, logical order, sidebar, mobile More sheet, command palette, chords, dialog trap/Escape, form labels/errors, live announcements, table semantics, non-color status, touch targets, zoom/reflow, and meaningful/decorative image treatment.
6. Validate invoice print at A4 without dark-mode leakage; QR, totals, VAT, and calculations are functional evidence, not visual decoration.
7. Inspect browser console and network for errors, missing assets, excessive media, and unexpected eager destination fetches.
8. Fix feasible issues, rerun affected checks, and write exact evidence/limitations to `docs/design/visual-qa.md`. Do not describe an unrun width, theme, flow, or command as passing.
