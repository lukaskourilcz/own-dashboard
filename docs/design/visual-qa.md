# OwnDashboard visual QA

Date: 2026-07-22

Scope: private sign-in, authenticated shell, core professional workflows, project workspace, semantic design system, responsive navigation, accessibility states, and deferred-media seams.

## Method

`/dev-preview` remains the canonical fixture-only visual harness and returns 404 in production. The Playwright suite now encodes checks at 360, 430, 768, 1024, 1440, and 1728 px. The matrix includes Czech at 360 px, dark mode at 1024 px, desktop/mobile navigation changes, horizontal overflow, the mobile Quick Add clearance, and access to every destination through the mobile More sheet.

The test suite also covers:

- keyboard-reachable canonical navigation and stale-preference repair;
- the project workspace and its horizontal tab model;
- login and OAuth callback errors;
- removed personal destinations;
- mobile destination-sheet semantics;
- axe scans for serious or critical WCAG A/AA violations;
- print-specific invoice behavior already covered by the repository suites.

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
| Fixed controls | Quick Add does not overlap the mobile navigation |
| Localization | Narrowest matrix case renders Czech fixtures |
| Theme | 1024 px matrix case renders dark mode |
| Accessibility | The open mobile destination dialog is included in axe coverage |
| Auth failure | OAuth callback errors expose an alert with an actionable explanation |

## Runtime result

The browser-backed visual run could not be completed in this environment. Both the default Turbopack development server and a fresh-cache webpack development server started, but did not return `/login` within the configured Playwright server window; the webpack attempt remained in route compilation for more than twenty minutes. The in-app browser also rejected a localhost reload under its URL policy. The processes were stopped cleanly, and the generated `.next` cache was moved to Trash as a recoverable cleanup.

Accordingly, this document does not claim screenshot, axe-runtime, responsive-runtime, or invoice-print-runtime success. The checks are implemented and discoverable, but must be rerun when the local Next server can serve the deterministic preview. Static TypeScript/JSX bundling and unit-test results are recorded in the final implementation report and should not be mistaken for visual execution.

## Media QA

No Higgsfield output or substitute artwork was generated. There are therefore no shipped media files to inspect for text artifacts, watermarks, third-party marks, crop failures, motion, or file-size budgets. The deferred manifest describes intended placements and accessibility classifications without production references. When Higgsfield becomes available, use the art-direction and manifest documents, integrate only accepted assets, and then extend this record with real dimensions, sizes, light/dark/mobile crops, reduced-motion fallback, and contextual screenshots.

## Rerun

1. Start from a clean generated cache if the local compiler continues to compact indefinitely.
2. Run `npm run test:e2e` so Playwright owns the fixture server.
3. Inspect failures at each encoded width instead of updating snapshots blindly.
4. Capture authentic `/dev-preview` screenshots only after functional assertions and axe pass.
5. Check both languages, both themes, long labels and values, zoom/reflow, focus order, dialog escape/focus return, and invoice print preview manually.
6. Record exact results here; do not convert unexecuted coverage into a pass claim.
