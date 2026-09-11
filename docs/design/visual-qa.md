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

## Career application pipeline — 2026-09-11

The Career change adds a prepared-application list with posting and Google Drive links, a sent transition, response/follow-up editing, and cohort statistics. Only fictitious fixture records are used in preview screenshots; imported company research and real letters remain in the owner's database and Drive.

Visual review found that a horizontal action group at 1024 px squeezed the role title into a narrow column even though the page passed the overflow check. Prepared rows now keep their actions below the company and role at every width. Small positive-fit badges and matched-skill chips use the foreground text token to fix the contrast violations found by axe.

The new E2E coverage exercises both document links, the manual sent transition and its stable request ID, response entry and the resulting response rate, plus Czech prepared rows at 360, 430, 768, 1024, 1440 and 1728 px. The 1024 px case uses dark mode. Existing navigation tests were updated to reflect the already-removed Agents destination and Quick Add control, and mobile heading assertions are scoped to the shell header.

The test backend returns the persisted application after each mutation so cache invalidation can be checked through a realistic read-after-write flow. Database rollback checks separately cover the real RPC, retry idempotency, history and ownership; the preview does not verify a signed-in production session or Google account permissions.

No new media was generated. Broader manual zoom/keyboard audits and every disconnected/error state were not repeated for this feature; the existing automated navigation, accessibility, responsive, PWA and invoice suites remain the release checks.

The completed full run recorded 45 passes, 33 intentional project skips and two failures in existing tests: external Google favicon requests failed, and the mobile posting-detail test still expected the former “Prepare application” action. The fixture harness now serves a local transparent favicon response, and the detail assertion checks the current “Save position” action. The two affected checks are rerun separately after those test-only corrections.

All new Career checks passed in the full run, including the desktop/mobile sent-and-response flow and the six-width Czech/axe matrix. Authentic screenshots of the prepared rows, the corrected 1024 px dark layout and the desktop/mobile response statistics were visually inspected.

Final verification: `npm run lint` and `npx tsc --noEmit` passed; `npm run test` passed all 276 tests in 30 files; the production build passed. `npm run test:e2e -- --last-failed` then passed both corrected checks. Across the full run and that targeted rerun, all 47 executed E2E checks passed, with 33 deliberate desktop/mobile project skips and no unresolved failure. The entire suite was not repeated after these two test-only corrections.
## Freelance opportunities — 2026-09-11

The platform directory and proposal editor were checked in the deterministic public preview at 360, 430, 768, 1024, 1440 and 1728 px, including Czech, English and a dark 1024 px case. Checks cover opening each editor, profile text, document/source fields, date-order feedback, dialog accessibility and horizontal overflow. Mobile platform rows and the dark profile dialog were visually inspected. Owner profiles, proposals and Drive URLs are excluded from preview fixtures and screenshots.

`npm run lint`, `npx tsc --noEmit`, all 278 unit tests in 31 files, and the production `npm run build` passed. The full E2E run recorded 47 passes, 34 intentional skips and one failure because the new English dialog test matched both Close buttons. Its selector was scoped to the first match, and the targeted six-width check passed; it passed again after the aggregate metrics and resource links were added. Across the full run and targeted repair, all 48 executed checks passed. The full suite was not repeated after that correction.

Live database checks used owner and unrelated authenticated claims to verify RLS, absence of client event-write grants, the history trigger in a rolled-back transaction, and full-cohort metrics with zero submissions. Browser preview does not verify a signed-in production session or external account creation. No new media was generated.

## Resource library — 2026-09-11

The Links change was checked with synthetic preview records at 360, 430, 768, 1024, 1440 and 1728 px, including Czech, English and a dark 1024 px case. Collapsed cards expose name, domain, pricing dot and edit/delete actions; keyboard disclosure, pricing filters, empty search, clear filters and both dialogs passed. The revised matrix also checks expanded multi-paragraph content and a long source URL, with axe scans and horizontal-overflow assertions.

Visual inspection of all six initial widths found that the sidebar left too little room for two columns at 768 px, despite passing overflow checks. The second column now starts at 1024 px, and the targeted six-width matrix passed again. The corrected tablet view and expanded mobile/dark views were inspected. Favicons use a deterministic transparent fixture response, so these screenshots do not test third-party logo availability; production retains an initial fallback on image failure. No owner records or research imports appear in preview screenshots, and no new media was generated.

`npm run lint`, `npx tsc --noEmit`, `npm run test` (280 tests in 32 files) and the ordinary production `npm run build` passed. The full `npm run test:e2e` run passed 49 checks with 35 intentional project skips; after the tablet breakpoint and longer fixture were added, `npm run test:e2e -- e2e/link-library.spec.ts` passed the six-width check with one intentional mobile-project skip. The whole E2E suite was not repeated after that bounded layout correction. An intermediate lint invocation raced with Playwright clearing its output directory and failed with ENOENT; the final lint run completed successfully after the browser run.

Read-only authenticated database transactions verified that the owner can read 119 links and 19 categories, while unrelated claims read zero of either. All 36 new entries have dated source notes and all category references belong to the owner. The existing own-only policies remain enabled. These checks verify stored data and fixture behavior, not a signed-in production browser session or subscription entitlements on third-party sites. Pricing remains a dated manual assessment, and three older entries retain an explicit unverified marker.
