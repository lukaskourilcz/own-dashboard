# OwnDashboard visual QA

Date: 2026-07-22

Scope: private sign-in, authenticated shell, core professional workflows, project workspace, semantic design system, responsive navigation, accessibility states, and deferred-media seams.

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
- axe scans for serious or critical WCAG A/AA violations;
- a dark-mode Czech invoice rendered to a parsed, single-page A4 PDF.

## Implementation review

The code review and static checks confirmed these design constraints:

- one canonical sidebar/mobile/shortcut/command-palette navigation model;
- a five-destination mobile hierarchy with all remaining areas in an accessible dialog;
- safe-area-aware fixed navigation and a Quick Add control positioned above it;
- semantic light/dark tokens for surfaces, statuses, charts, focus, and AI evidence;
- tabular figures for money, dates, rates, and counts;
- restrained radii and shadows, with elevation reserved for overlays;
- no shipped gradients, sparkles, glass panels, generated UI, or decorative finance media;
- generated-media slots do not request missing files;
- reduced-motion behavior remains active through CSS and the shared Motion configuration;
- printed invoices retain fixed paper colors and print isolation.

## Automated coverage added

| Area | Assertion |
| --- | --- |
| Responsive matrix | No document-level overflow at all six required widths |
| Navigation | Desktop sidebar and mobile bottom navigation switch at the defined breakpoint |
| Mobile hierarchy | More opens an accessible destination dialog and navigates to Opportunities |
| Career table | Match/Remote/Location remain semantic and the wide table scrolls without widening the mobile page |
| Operational workflows | Project Communication, the Agents queue, and subscription grouping/renewals render from deterministic fixtures |
| Fixed controls | Quick Add does not overlap the mobile navigation |
| Localization | Narrowest matrix case renders Czech fixtures |
| Theme | 1024 px matrix case renders dark mode |
| Accessibility | The open mobile destination dialog is included in axe coverage |
| Auth failure | OAuth callback errors expose an alert with an actionable explanation |

## Runtime result

The final `npm run test:e2e` run completed against the optimized local Next.js server: **43 passed, 31 intentionally skipped by project, 0 failed** across the desktop and mobile projects. The skips avoid duplicating desktop-only coverage in the mobile project and vice versa; no required assertion was disabled to obtain the result.

Verified runtime evidence:

- the responsive matrix completed without document-level overflow at all six required widths;
- Czech rendered at 360 px, dark mode rendered at 1024 px, and the remaining matrix cases rendered in English/light mode;
- desktop sidebar, mobile navigation, mobile More dialog, and fixed Quick Add clearance passed;
- login plus 17 representative authenticated destinations passed axe with no serious or critical WCAG A/AA violations;
- the open mobile destination dialog passed axe and remained keyboard/semantics reachable;
- all 23 canonical destinations (22 sidebar areas plus Settings) opened without console errors;
- Career sorting, mobile table containment, project Communication, the Agents queue, and subscription group/importance/countdown presentation passed their workflow assertions;
- the manifest, dynamic PNG icon, and maskable icon declaration passed;
- a dark-mode Czech invoice remained white, retained print isolation, generated a PDF larger than 10 KB, parsed successfully, and occupied exactly one A4 page;
- the rendered invoice was visually inspected after the print-spacing correction; the earlier footer-only second page no longer exists.

The suite intentionally uses a production-backed fixture server because cold development compilation was nondeterministic under shared host load. Per-test assertions remain capped at 90 seconds; only the one-time build/server setup receives a longer window.

## Media QA

No Higgsfield output or substitute artwork was generated. The MCP connected and cost preflight worked, but the active trial reported zero usable generation credits; the attempted requests returned no media. There are therefore no shipped files to inspect for text artifacts, watermarks, third-party marks, crop failures, motion, or file-size budgets. The manifest records the exact gate, requests, intended placements, and accessibility classifications without production references. After usable credits are available, integrate only accepted assets and extend this record with real dimensions, sizes, light/dark/mobile crops, reduced-motion fallback, and contextual screenshots.

## Rerun

1. Run `npm run test:e2e`; Playwright builds once and owns the optimized fixture server.
2. Inspect failures at each encoded width instead of weakening assertions or updating snapshots blindly.
3. Capture authentic `/dev-preview` screenshots only after functional assertions and axe pass.
4. Recheck both languages, both themes, long labels and values, zoom/reflow, focus order, dialog escape/focus return, and invoice print preview whenever shared layout or typography changes.
5. Keep `NEXT_E2E` confined to local/CI test processes. Never configure it in a deployed environment.
