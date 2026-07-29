# OwnDashboard visual QA

Date: 2026-07-27

> Note (2026-07-29, commit `268062b`): the natural-language Quick Add control and its mobile fixed-position button were removed. The "mobile Quick Add clearance" checks and the "Quick Add control positioned above [safe-area navigation]" constraint referenced below no longer apply. The remainder of this report reflects the state on 2026-07-27.

Scope: private sign-in, macOS-native authenticated shell, core professional workflows, project workspace, semantic design system, responsive navigation, accessibility states, and deferred-media seams.

## Method

`/dev-preview` remains the canonical fixture-only visual harness and returns 404 in ordinary production builds. Playwright sets the server-only `NEXT_E2E=1` flag on its local production build so the same optimized server can expose fixtures during tests. The suite checks 360, 430, 768, 1024, 1440, and 1728 px. The matrix includes Czech at 360 px, dark mode at 1024 px, desktop/mobile navigation changes, horizontal overflow, the mobile Quick Add clearance, and access to every destination through the mobile More sheet.

The test suite also covers:

- keyboard-reachable canonical navigation and stale-preference repair;
- the project workspace and its horizontal tab model;
- login and OAuth callback errors;
- removed personal destinations;
- mobile destination-sheet semantics;
- the width-contained mobile Career table and its sortable columns;
- subscription grouping, importance, next-payment dates, and renewal countdowns;
- the project communication timeline and VPS Agents task queue;
- Home daily focus with seven deterministic items, GLOBAL priority, waiting age, regeneration, completion garden, and active-project navigation links;
- Career selection semantics and owner-scoped permanent deletion controls;
- application-styled destructive confirmation surfaces;
- axe scans for serious or critical WCAG A/AA violations;
- a dark-mode Czech invoice rendered to a parsed, single-page A4 PDF.

## Implementation review

The code review and static checks confirmed these design constraints:

- one canonical sidebar/mobile/shortcut/command-palette navigation model;
- a viewport-contained graphite desktop and an app window inset 20 px vertically and 30 px horizontally, three window controls, 224 px translucent sidebar, and 52 px toolbar;
- a five-destination mobile hierarchy with all remaining areas in an accessible dialog;
- safe-area-aware fixed navigation and a Quick Add control positioned above it;
- semantic light/dark tokens for surfaces, statuses, charts, focus, and AI evidence;
- tabular figures for money, dates, rates, and counts;
- compact 12 px modules, 22 px section-identity title tiles, 32 px KPI icon tiles, and 12–12.5 px data tables;
- primary Projects and Career tables fit the 13-inch desktop content width before horizontal scrolling;
- task titles wrap to three lines and dynamic Task/Link groups use masonry rather than forced equal-height rows;
- every production badge/tag uses at least 3 px vertical and 7 px horizontal padding;
- gradients are confined to the graphite desktop and primary button; there are no sparkles, floating glass panels, generated UI, or decorative finance media;
- generated-media slots do not request missing files;
- reduced-motion behavior remains active through CSS and the shared Motion configuration;
- printed invoices retain fixed paper colors and print isolation.

## Automated coverage added

| Area | Assertion |
| --- | --- |
| Responsive matrix | No document-level overflow at all six required widths |
| Navigation | Desktop sidebar and mobile bottom navigation switch at the defined breakpoint |
| macOS shell | Desktop Home exposes the contained app window, shared toolbar, and exactly three traffic-light controls |
| Mobile hierarchy | More opens an accessible destination dialog and navigates to Opportunities |
| Career table | Match/Remote/Location remain semantic and the wide table scrolls without widening the mobile page |
| Operational workflows | Project Communication, the Agents queue, and subscription grouping/renewals render from deterministic fixtures |
| Daily focus | Seven active/GLOBAL tasks from the canonical Tasks source, priority order, waiting age, regeneration, garden, and active-project navigation render from deterministic fixtures |
| Project navigation | Active-project links open inside the persistent shell; the Projects parent returns to the full table and browser history preserves the selected context |
| Preference persistence | Navigation visibility and project-workspace tab visibility survive reload in the deterministic client cache; database persistence is covered by own-only migration contract tests |
| Confirmation dialog | Destructive confirmation uses an opacity-only entry and remains centered without a first-frame position shift |
| Fixed controls | Quick Add does not overlap the mobile navigation |
| Localization | Narrowest matrix case renders Czech fixtures |
| Theme | 1024 px matrix case renders dark mode |
| Accessibility | The open mobile destination dialog is included in axe coverage |
| Auth failure | OAuth callback errors expose an alert with an actionable explanation |

## Runtime result

The final `npm run test:e2e` run completed against the optimized local Next.js server: **47 passed, 35 intentionally skipped by project, 0 failed** across the desktop and mobile projects. The skips avoid duplicating desktop-only coverage in the mobile project and vice versa; no required assertion was disabled to obtain the result.

Verified runtime evidence:

- the responsive matrix completed without document-level overflow at all six required widths;
- Czech rendered at 360 px, dark mode rendered at 1024 px, and the remaining matrix cases rendered in English/light mode;
- desktop sidebar, mobile navigation, mobile More dialog, and fixed Quick Add clearance passed;
- login plus 17 representative authenticated destinations passed axe with no serious or critical WCAG A/AA violations;
- the open mobile destination dialog passed axe and remained keyboard/semantics reachable;
- all 23 canonical destinations (22 sidebar areas plus Settings) opened without console errors;
- Career sorting, mobile table containment, project Communication, the Agents queue, and subscription group/importance/countdown presentation passed their workflow assertions;
- Home rendered the deterministic seven-task focus at desktop and mobile widths, including GLOBAL, waiting-age, garden, regeneration, and active-project navigation assertions;
- project links stayed inside the shell, the Projects parent restored the full table, navigation/project-tab choices survived a new page load, project tasks grouped correctly, and the destructive confirmation stayed centered from its first frame;
- the manifest, dynamic PNG icon, and maskable icon declaration passed;
- a dark-mode Czech invoice remained white, retained print isolation, generated a PDF larger than 10 KB, parsed successfully, and occupied exactly one A4 page;
- the rendered invoice was visually inspected after the print-spacing correction; the earlier footer-only second page no longer exists.

The suite intentionally uses a production-backed fixture server because cold development compilation was nondeterministic under shared host load. Per-test assertions remain capped at 90 seconds; only the one-time build/server setup receives a longer window.

## Media QA

No generated artwork was produced. There are therefore no shipped files to inspect for text artifacts, watermarks, third-party marks, crop failures, motion, or file-size budgets. The manifest records prompts, intended placements, provider-selection gates, and accessibility classifications without production references. After a researched low-cost/free provider produces reviewed assets, extend this record with provider/model provenance, license and pricing sources, real dimensions, sizes, light/dark/mobile crops, reduced-motion fallback, and contextual screenshots.

## Rerun

1. Run `npm run test:e2e`; Playwright builds once and owns the optimized fixture server.
2. Inspect failures at each encoded width instead of weakening assertions or updating snapshots blindly.
3. Capture authentic `/dev-preview` screenshots only after functional assertions and axe pass.
4. Recheck both languages, both themes, long labels and values, zoom/reflow, focus order, dialog escape/focus return, and invoice print preview whenever shared layout or typography changes.
5. Keep `NEXT_E2E` confined to local/CI test processes. Never configure it in a deployed environment.
