# OwnDashboard visual QA

> App-wide review checkpoint (2026-10-24): [findings 78–85](../reports/app-wide-audit-2026-10-23/review.md) cover connection-status recovery, versioned OAuth removal and confirmed sign-out. The targeted runs pass 32 distinct desktop/mobile browser cases, including all 25 visible destinations at six widths, EN/CS/theme samples, command-palette focus, unsaved-draft/history recovery, login and tour isolation. Four final tour checks include blocked command-palette logout. Six duplicate-project matrix cases are intentionally skipped. Component checks exercise localized logout retry and the draft guard before any server action. These are fixture checks, not a real owner logout or final app-wide release; remaining source and optimized release review continues.

> Implementation update (2026-10-23): [the audit implementation report](../reports/dneskai-audit-implementation-2026-10-23.md) records completed changes and exact release checks (2,779 unit/integration passes, one existing skip; 247 browser passes, 79 project-specific skips). [Actual before/after captures](../reports/dneskai-code-ux-audit-2026-10-23/implementation.html) are separate from the original proposed treatments. The new fixture matrix covers all 25 visible destinations at six widths; hidden Inbox/References retain their URL-only policy. Keyboard/focus, axe, EN/CS/theme samples, failed-save recovery, install metadata and the one-page dark-mode A4 invoice passed. Browser tests use isolated Chromium because the signed-in Chrome extension was unavailable. Manual screen-reader and actual browser zoom checks remain unrun; Production is unchanged.

> Review update (2026-10-23): the [DNESKAi and application UX audit](../reports/dneskai-code-ux-audit-2026-10-23/README.md) adds current fixture screenshots, DOM measurements, code findings and a visual implementation plan against `d6f60c7`. Its [validation record](../reports/dneskai-code-ux-audit-2026-10-23/validation.md) distinguishes checks run from follow-up work. This was a review, not a new UI release or a full WCAG/A4 certification; the historical results below retain their original date.

Date: 2026-07-27

> Note (2026-07-29, commit `268062b`): the natural-language Quick Add control and its mobile fixed-position button were removed. The "mobile Quick Add clearance" checks and the "Quick Add control positioned above [safe-area navigation]" constraint referenced below no longer apply. The remainder of this report reflects the state on 2026-07-27.

> Note (2026-07-29, commit `5d32e6b`): the Agents task queue and every model-backed AI surface were removed. The Agents checks in the coverage list, the workflow table and the results no longer apply.

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

## Links / Ideas review and export — 2026-09-15

The new UI uses the existing `/dev-preview` shell, semantic components and deterministic fixtures. No generated media was added.

- `npm run test`: 28 files, 259 tests passed, including four export/legacy-description tests.
- `npm run lint`: passed. Generated Playwright reports and test artifacts are now excluded from source linting.
- `npx tsc --noEmit`: passed after using the same Axe/Playwright type bridge as the existing accessibility suite (the lockfile contains two Playwright core versions).
- `npm run build`: passed; the targeted browser run also rebuilt the production-backed fixture server.
- Full `npm run test:e2e`: 45 passed, 33 skipped, 4 failed. Three failures waited for the removed Agents navigation; one expected the absent mobile Quick Add button. These tests and the corresponding shell were unchanged in this feature diff. A clean-baseline browser rerun was not performed, so these are not claimed as experimentally proven baseline failures. They remain release-suite limitations.
- Targeted `npm run test:e2e -- e2e/link-export.spec.ts`: 8 passed. Idea creation used a mocked authenticated backend, verified `record_type=idea`, placement below Links, rating, expandable relevance and source links. Targeted export checks passed on desktop and mobile: exact pricing selection, JSON/Markdown preview, copied content, download filename, clipboard denial with manual fallback, Escape and trigger focus return, and zero axe violations in the dialog.
- Czech dark-mode export passed overflow checks at 360, 430, 768, 1024, 1440 and 1728 px. The captured authentic 1728 px dialog screenshot was visually inspected: readable controls, contained preview and visible actions.
- The existing full suite also passed its responsive-width matrix and Czech A4 invoice checks. No changes were made to invoice or shared navigation behavior.
- Live database probes ran with the authenticated role and rolled back: non-owner reads returned no rows, spoofed-owner writes and unowned-category writes were rejected, and owner reads returned all 174 imported records.

Private research evidence, exports and per-post coverage remain outside Git under `.claude/observations/reel-research/`. Production sign-in and a deployed Ideas/export interface were not tested; this task did not deploy application code.

## Main integration — 2026-09-16

Integrated the Ideas/export feature with main's newer searchable expandable resource cards. Both sections share pricing/category/search filters, sorting and expand/collapse controls; card details retain ratings, rationale, repository relevance and sources. Existing Career work remains intact.

- Lint and TypeScript passed; 33 unit-test files / 284 tests passed.
- Combined library/export browser checks: 9 passed, 1 intentionally skipped duplicate mobile matrix. Covered six widths, EN/CS, keyboard controls, axe, Idea creation, export pricing/copy/download and clipboard denial.
- Updated selectors for the combined search label, expandable Idea cards and distinct source links. The initial selector failures were corrected before the passing run.
- A local dependency symlink was rejected by Turbopack; a local dependency copy resolved setup. Both the E2E production build and ordinary production build passed.
- Previous full-suite limitations remain documented above; the full suite was not rerun for this integration.
- User explicitly authorized a main push and redeployment in the follow-up.

## Focused taxonomy and export controls — 2026-09-16

Links and Ideas now use separate export dialogs. The targeted browser suite covered all-record, selected-category and individual-record selection; free, combined free/freemium and exact price filters; detailed, compact and category-grouped JSON; Markdown; clipboard and download; clipboard denial; Escape/focus return; and dialog axe scans. Ideas render their goal as the row label and expose the observed Reel subject, benefit, project relevance and original source after expansion.

- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run test`: 33 files, 286 tests passed.
- `npm run build`: passed.
- `npx playwright test e2e/link-export.spec.ts`: 8 passed across desktop and mobile.
- The Czech dark export dialog passed document-overflow checks at 360, 430, 768, 1024, 1440 and 1728 px with no axe violations.
- The live owner collection contains 171 links and 17 ideas in 37 link categories and 10 idea categories, with no uncategorized records. The code test harness continues to use synthetic fixtures rather than owner data.

## Career stage board — 2026-09-17

Applied gained a board layout beside its list, and the follow-up date it shows
now also appears on the Work overview and in the Home hero.

- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm run test`: 45 files, 505 tests passed, including the new
  `tests/lib/jobs-board.test.ts`.
- `npm run build` and `npm run test:e2e` were **not run in this session** — they
  are executed centrally for this change. `e2e/career-board.spec.ts` is written
  and covers the five column headings and their counts, the saved column's
  review button, the due follow-up cue, the payload a stage change posts, plus
  a Czech width matrix at 360, 430, 768, 1024, 1440 and 1728 px with
  document-overflow and axe `wcag2a`/`wcag2aa`/`wcag21aa` scans. Its screenshots
  and axe results are therefore not yet recorded here; this entry will be
  incomplete until that run reports.
- Design decisions made without a browser: the board is the only horizontal
  scroller on the page and is labelled and focusable, each column is a heading
  rather than a landmark so the board does not bury the page's real ones, and
  the overdue follow-up carries the word "due" as well as the warning tone.

## IG TIPS, detected Tools and the Own/Freelance switch — 2026-09-26

IG TIPS left Links for its own Library section, Tools lists what the active
projects' repositories use, and Settings gives each active project an Own or
Freelance control.

- `npm run lint`, `npx tsc --noEmit` and `npm run build`: exit 0 on the final
  commit. `npm run test`: 60 files, 654 tests, exit 0. Every commit of the
  branch also passed `tsc` and the unit tests on its own.
- `npm run test:e2e`, full suite on the commit before the paged detected list:
  162 tests, 97 passed and 65 skipped by project design, exit 0 in 4.6 minutes.
  The web server logged two `getaddrinfo ENOTFOUND example.supabase.co` errors
  from server-side session checks with the fixture cookie; no test failed.
  After the paged list, `e2e/tools.spec.ts`, `e2e/a11y.spec.ts` and
  `e2e/ig-tips.spec.ts` ran again: 34 passed, 24 skipped, exit 0.
- New browser coverage: IG TIPS topic sections, icon-free cards, keyboard
  details, topic chips, search, the tip export, adding and editing a tip, a link
  moved out of Links, and Czech at 360 px with 44 px card actions and no axe
  violations; Tools detected rows, the repository statuses and the project and
  text filters; the Own/Freelance switch both ways, a failed write, and Czech at
  360 px with axe.
- `/dev-preview` captures at 360 px and 1440 px in English light (IG TIPS, the
  detected Tools list, Settings → Active projects, Links, Projects) and at 360 px
  in Czech dark (IG TIPS, Settings) showed no horizontal overflow and no page
  errors. They stay outside Git; the three changelog captures in
  `media/changelog/` are committed.
- Limits: the stack parser was checked against the current `about-project.md`
  and `package.json` of the four public active repositories (75 distinct tools).
  Three active repositories are private and could not be read from the agent
  session, and the live route has not run against GitHub, because the preview
  uses fixtures. Nothing was deployed.

## 28 September 2026 maintenance

Existing components and tokens retained. Production-build fixture checks covered desktop/mobile navigation, accessibility and IG TIPS editing. A tip can return to Links via the labelled Type control. Full suite: 105 passes, 70 layout-specific skips, three fixture/interaction failures corrected; affected-suite rerun: 24 passes, 12 skips. No new generated media.

## Oslo Career and shared Apple-style interface — 16 October 2026

Production-code preview, with fictional private records, reviewed at 360, 430, 768, 1024, 1440 and 1728 px. The Oslo matrix covers Czech/light and English/dark at every width; existing Czech pipeline matrices also cover dark at 1024. No horizontal document overflow or axe WCAG 2.0/2.1 A/AA violations in the final run. Desktop and mobile screenshots were inspected. The shared sidebar, toolbar, cards, controls, typography and dialogs affect all product areas; existing navigation, data-loading, finance, project, editor, PWA and invoice checks remain covered.

Final automated results: `npm run lint` passed; `npx tsc --noEmit` passed; `npm run test` passed (142 files / 1,406 tests, one intentionally skipped test); `CI=1 npm run test:e2e` passed (131 tests, 71 expected viewport/capture skips, no failures or retries). The e2e setup compiles production code with the fixture-only `NEXT_E2E` guard. The ordinary `npm run build` also passed; the last build is recorded separately in the release handoff. The desktop invoice test verifies a white, isolated one-page A4 PDF in dark mode, including the QR.

Career checks cover public research without eager private/scraper requests; the 14-match / 33-role grid; full role/score/gap details; private-letter loading boundaries; English draft fields; unsaved-edit discard/keep; focus returning to the invoking card; the Czech checkbox OFF default and archive restoration; text-only readiness; sent snapshots, response history and stage updates. Manual Chrome checks with normal motion confirmed the TypeSafe AI evidence, no overflow, Escape focus return, empty-search recovery and unknown-availability feedback. Preview never exposes actual private letters.

Repairs driven by testing: page actions now wrap before wide-desktop sizing; selected-sidebar and dark primary-action contrast were corrected; Tailwind 4 owns modal centering (entry keyframes only add relative scale/offset); outgoing pages unmount immediately so duplicate headings/status/live regions cannot survive during navigation. Whole-page initial fades were removed to avoid transient low-contrast text, including under reduced motion. Unsaved counts are shown as unknown until private data loads. No generated imagery or fake product screens were introduced.

Private deployment data checks: the preference migration version matches production history; RLS remains enabled on saved positions, preferences, applications and companies, with four owner-scoped saved-position policies. Thirty-three new private English drafts exist; all twelve prior saved rows were compared field-for-field with their backup and remain unchanged. The shared English CV link is configured and Czech Career is false. No employer applications were submitted. Browser fixture RPC tests cover sending; a live production write round-trip is not claimed by these checks.

Ordinary release build (without `NEXT_E2E`) passed again after the final code edits: compilation 14.3 s, TypeScript 18.5 s. A production-server smoke check returned login 200, Career redirect 307 to login, fixture preview 404, and the research-check API 401 without authentication (cross-origin/missing-Origin attempts returned 403). The final lint and explicit TypeScript checks passed.

## DNESKAi Design Lab continuation — 22 October 2026

The review tab opens a queue/stage/inspector prototype with Editorial only. Authentic full-size synthetic renders are generated by the vendored studio; no source photograph or production record appears in QA. The preview's fixture-only renderer produces new bytes after an edit and remains disabled in ordinary production.

Eight Playwright checks passed across desktop/mobile and EN/CS, with light/dark themes, reduced motion, fit feedback, dirty-state navigation, saving/re-rendering, approval and batch results. The two language flows in each viewport include axe WCAG 2.2 AA scans, no horizontal document overflow, no console errors and no live marketing API requests. Six additional checks passed at widths 360, 430, 768, 1024, 1440 and 1728 px, including the pixel scroll region and selected-slide reload. Desktop and phone screenshots were inspected. An initial duplicate React key in the profile grid was fixed and the eight flows rerun cleanly. The width test clicks the visible view label rather than the visually hidden radio input.

Existing List review tests remain reachable through the explicit List control. No unrelated invoice print, account permission rollout, live publication or notification was exercised by these focused checks. Complete application regression and integration gate outcomes belong to the handoff log; they are not implied by the focused results above.

The integrated release check also covers the public `/guest` Lab as read-only in both browser projects, with no fixture-render or marketing API request. Legacy Sources-to-review tests now expect the Lab; legacy card-editor tests explicitly select List after returning from other tabs. Their navigation and responsive/axe coverage remain intact. A missing-asset demo save now invokes the real fixture renderer even when the deck is unchanged; a dedicated offline regression checks its full-size output. Final browser remediation totals are recorded in LOG.md.

## Project workspace without its header — 22 October 2026 (#171)

Every project workspace now opens on its tab row. The back button „Všechny projekty“, the eyebrow, the summary and the status badge are gone for every project; the toolbar breadcrumb „Projekty › <project>“ carries the context, and its „Projekty“ title is a button that returns to the table (Enter or click). The development and live links moved into the Overview summary card.

`/dev-preview` screenshots of DNESKAi (For review today) and devShark (Overview) were taken and inspected in CS and EN, light and dark, at 1440 px desktop and Pixel 5 mobile: no header above the tabs, no horizontal overflow, breadcrumb legible in both themes. `e2e/dashboard.spec.ts` (desktop and mobile) passed 28/28 together with the screenshot run; it checks that only the toolbar `h1` remains, that „All projects“ is gone on DNESKAi and devShark, and that the breadcrumb button returns to `/projects` from the keyboard.

## DNESKAi state tints and short dates — 22 October 2026 (#173)

Lab queue cards and Příspěvky cards show a post's state as their background (soft token over the opaque surface) instead of a chip; the state words stay in each card's accessible name and tooltip.

Contrast (WCAG 2.2 AA, computed from the tokens in `globals.css`; the tint sits on `--surface`, so the page background behind the card does not change it):

| Text on tint | Light: success / information / warning / risk / muted | Dark: success / information / warning / risk / muted |
|---|---|---|
| `--foreground` | 15.18 / 14.57 / 15.02 / 14.29 / 14.52 | 13.24 / 12.56 / 13.15 / 13.72 / 13.68 |
| `--foreground-muted` | 6.26 / 6.00 / 6.19 / 5.89 / 5.98 | 7.11 / 6.74 / 7.06 / 7.37 / 7.35 |
| `--foreground-muted`, `prefers-contrast: more` | 10.48 / 10.06 / 10.37 / 9.86 / 10.02 | 11.17 / 10.59 / 11.09 / 11.57 / 11.54 |
| `--warning` (deadline note) | 5.15 / 4.94 / 5.09 / 4.85 / 4.92 | 7.51 / 7.12 / 7.46 / 7.78 / 7.76 |
| `--information` (Instagram link) | 5.06 / 4.85 / 5.01 / 4.76 / 4.84 | 7.04 / 6.68 / 6.99 / 7.29 / 7.28 |
| `--risk` (error code) | 5.97 / 5.73 / 5.91 / 5.62 / 5.71 | 5.91 / 5.60 / 5.87 / 6.12 / 6.10 |

Every pair passes 4.5:1. A translucent tint laid straight on the page background (`#f3f4f6`) would have dropped `--success` text to 4.20:1, which is why the tint utilities paint `--surface` first. Axe (wcag2a–wcag22aa) passes on the Lab in English/light and Czech/dark and on Příspěvky in both, at desktop and Pixel 5 widths. Dates read `DD/MM` (`formatDneskaiDay`) in both languages. The macOS baselines in `e2e/dneskai-lab-visual.spec.ts-snapshots/` were regenerated for #169, #172 and this change and reviewed one by one.

## DNESKAi topics list (Náměty) — 22 October 2026

The topics section at the top of the Design Lab (#154) was checked on `/dev-preview` with the synthetic topics in `src/lib/demo/dneskai-topics-fixtures.ts`. `e2e/dneskai-lab.spec.ts` runs it at 1280 and 360 px in English (light) and Czech (dark), in both browser projects: axe WCAG 2.2 AA on the section, no horizontal document scroll, no console errors and no request to a marketing API. The same flow approves and rejects by keyboard (↓, A, Z), approves two selected topics at once and restores one from the archive. Axe first flagged the approved row: its reduced opacity brought the chips and the source link below 4.5:1, so the row now uses full opacity. The visual baseline spec hides the section, so the committed Lab baselines stay valid; on macOS all 75 tests of the lab, visual and workspace specs passed (one skipped).

English, 1280 px, light:

![Topics list in English at 1280 px](screenshots/dneskai-topics-en-1280.png)

Czech, 360 px, dark (the fixed phone navigation crosses the element capture):

![Topics list in Czech at 360 px](screenshots/dneskai-topics-cs-360.png)


## App-wide Finance controls — 24 October 2026

The ongoing app-wide review checked Bank connections beside payment matching at 360, 430, 768, 1024, 1440 and 1728 px. Desktop peers have equal widths and aligned top edges, without implicit grid columns. Bank actions remain visible, named per connection and 44 px on mobile. Headings/copy are shorter, and the CSV instruction describes file selection rather than an unsupported drop action.

Sixteen EN/CS desktop/mobile browser cases pass across bank failure/retry, pending actions, disconnect failure/partial revocation, CSV partial import recovery and payment selection recovery. Eight bank cases pass again after the final copy change. The failure-retry case uses a dark context; action/reflow/axe checks use light. All requests/records are isolated fixtures. This is targeted evidence; the final whole-app matrix and release verification remain pending.

## Bank connection dialogs — 24 October 2026

The app-wide review checked the GoCardless picker and Fio token form in EN/CS on desktop/mobile. Sixteen bank cases pass; eight picker cases pass again after the final mobile-size/503 changes. Checks cover failed-list retry, pending Back/Escape, unsafe-link refusal, configured-state failure, cleared credential input after confirmed storage, id-only sync retry and dialog axe scans. The picker reflows at 360, 430, 768, 1024, 1440 and 1728 px; picker checks use light and token recovery checks use dark. Every request uses isolated fixtures; no bank connection or credential was created. Final app-wide rendered release checks remain pending.

## Invoice state and recovery — 24 October 2026

Eighteen EN/CS desktop/mobile invoice cases pass for versioned payment changes, pending detail/list controls, failed deletion return, supplier/PDF/draft recovery, six-width document reflow, axe and print isolation. Six payment/deletion cases pass again after the final localized error copy. Row actions name their invoice; duplicate controls retain keyboard/touch visibility. Responses and records are isolated fixtures. Database tests separately verify that reopening and deletion clear payment links/metadata without deleting imported transactions. Final whole-app release checks remain pending.


## Public login and install metadata — 24 October 2026

The app-wide audit replaces the long repeated login headline, removes the repeated private-system subtitle, reduces the mobile hero spacing and removes the whole-page entrance fade. At 360×800, the Czech sign-in button moves from y=758.5–802.5 to y=526–570 in the callback-error view. Existing semantic controls and the two-column desktop layout remain. Sign-in errors retain a retryable control with EN/CS feedback.

Twelve local development-browser cases pass (eight duplicate-project skips), including 24 language/theme/width states at 360, 430, 768, 1024, 1440 and 1728 px, eight axe scans, console/reflow and mobile touch checks, preference-read failures in both system themes, verified PNG dimensions for every manifest icon, and the one-page A4 invoice in dark mode. Four sign-in recovery component cases and the separately recorded three analytics cases pass. TypeScript and targeted ESLint pass. This is fixture/development evidence; the optimized app-wide release remains pending. Screenshots are authentic app renders in the [audit assets](../reports/app-wide-audit-2026-10-23/assets/) directory.


Public optimized transfer checkpoint: with absent analytics configuration, cold 1440×900 anonymous contexts load 509,424 encoded JavaScript body bytes on `/guest` (previous build 579,278, −12.1%) and 310,066 on `/login` (previous 423,048, −26.7%). The PostHog SDK marker is absent from downloaded scripts after the fix. These measurements share Next.js 16.4.3, Chromium, EN/light/reduced motion and blocked nonlocal requests; raw resources and build IDs are committed with the [app-wide audit](../reports/app-wide-audit-2026-10-23/review.md). Full unit/lint/type/ordinary-build/render-trace checks pass at `6292d4e`; the complete optimized application interaction suite is pending.


## Repository notes, 24 October 2026

Four EN/CS desktop/mobile cases pass on the actual dev-preview repository components with mocked owner/API data. Checks cover retained failed text, keyboard Done/retry, a record changed during publication, 360/430/768/1024/1440/1728 px reflow, light/dark contexts and axe in the main region. The embedded card is centered and capped at the shared three-column content width; note edit/delete controls use 44 px mobile targets. Czech screenshots are in the [audit assets](../reports/app-wide-audit-2026-10-23/assets/). The mobile toolbar uses a concise NEEDED label and wraps if needed; control bounds are checked because document overflow alone missed a clipped toolbar in the intermediate version. Only the nonexistent-backend dev/E2E harness enables repository endpoints; the public tour stays isolated. This targeted evidence does not complete the remaining app-wide optimized interaction matrix.


## Repository task lists, 24 October 2026

Eight EN/CS desktop/mobile repository cases pass after atomic task import, including four note regressions. Unavailable source files show a retry message and no All clear; only actionable tasks appear in checkbox-based files. Failed imports preserve the list and a stale file version refreshes once. Checks cover 360/430/768/1024/1440/1728 px, long-name wrapping, keyboard note recovery and main-region axe. All data/providers are fixtures. This does not complete cold project-tab selection or the final optimized app-wide interaction matrix.


Repository scan follow-up: eight EN/CS desktop/mobile repository cases pass again after sharing the bounded scan. Initial load and retry use the shared request; a source-file conflict refreshes only that file, with no extra batch request. Existing note recovery, six-width reflow and main-region axe checks pass in the same run. Cache-order and late-disconnect behavior have separate component/client tests. No production provider ran.


## Preferences and Calendar, 24 October 2026

Preference saves: four final EN/CS desktop/mobile cases pass with unknown/retry/pending/confirmed renewal settings, keyboard and axe. Six earlier Settings/cross-tab cases pass against that source; two redundant mobile reflow cases are skipped. Calendar: 22 final cases pass with four intentional duplicate mobile skips. Checks include EN/CS light/dark, 360/430/768/1024/1440/1728 px reflow, incremental event lists, selection cancel/retry/confirmation and immediate cache refresh, pending form protection, failed-write draft retention, guarded navigation, keyboard, axe, browser-local dates and timezone writes. All backend/provider values are fixtures on the deliberately nonexistent-backend harness. Initial failed setup, locator, lint and cancellation-timing attempts are excluded. This is targeted development evidence; the full optimized app-wide release remains pending.


Repository link follow-up, 24 October: twelve EN/CS desktop/mobile cases pass across link, note and task recovery. Link checks cover unsafe inputs, retained failed text, pending Escape/edit prevention, concurrent saved-value review, confirmed removals and popover/main-region axe. Existing note/task cases retain their six-width and keyboard checks. All records/providers are fixtures. This does not complete repository-filter or the remaining optimized app-wide review.


Repository selection follow-up, 24 October: four final EN/CS desktop/mobile cases pass with 360/430/768/1024/1440/1728 px, visible footer bounds, named scroll region/axe, pending Escape/edit prevention, preserved off-page ids, device/server/both-unconfirmed saves and real cross-tab change/reload behavior. Five Home/Career regressions pass with one intentional mobile duplicate skip before the last selector-only edge-case fix. The first Czech run exposed DndContext accessibility ids changing between server and browser; Projects, Home and Career now provide stable ids and the corrected run has no hydration warnings. All data/providers are fixtures. Full optimized app-wide verification remains pending.


Repository metadata and cold tabs, 24 October: 24 final EN/CS desktop/mobile browser cases pass with two intentional duplicate-width skips. Checks cover named lookup outside the recent catalog, renamed identity, failed-refresh retention/retry, archived local controls, six widths, filter/link/note/task recovery, keyboard and axe. Cold server markup selects the requested tab before hydration on desktop/mobile. An initial link failure was traced to the default overview being replaced mid-click; server tab seeding fixes that transition without delaying/retrying clicks. The initial visible-only SSR assertion did not account for streamed hidden markup and is excluded. Final disconnected-cache precedence has a separate mounted regression after that browser run. All data/providers are fixtures; optimized app-wide verification remains pending.


GitHub history, 24 October: the combined metadata/link/history run passes 24 EN/CS desktop/mobile cases with two intentional duplicate-width skips. Following the final long-author and count-format layout changes, all twelve history cases pass again at six widths with axe, retained initial/refresh failures, a confirmed missing repository, explicit partial/capped Work scope and no live history request from ordinary preview. Project activity peer cards are centered at the shared repository width; chronological Work rows use a compact desktop metadata column. Author labels stay bounded without losing the visible date, code-volume counts follow the selected language and mobile commit/project links retain 44 px targets. The Czech card captures were inspected. The first Work fixture failed because it counted a cancelled development read as a completed initial result; final checks change failure state only after visible confirmation. Earlier failed fixture/type attempts are excluded. This is isolated development evidence, not the final optimized app-wide release.


Saved repository records, 24 October: 28 EN/CS desktop/mobile cases pass with two intentional duplicate-width skips. Following the final action-deadline guards, all sixteen local-record/task/note recovery cases pass again. A cold disconnected workspace shows only its own saved records, permits a captured-version edit and retains that edit after a verified reload/reconnection; provider metadata and publication controls remain unavailable until verified. Reused names with a different repository id cannot select publication controls. Six widths and main-region axe pass. Mounted tests also retain the same draft textarea through a disconnect/reconnect and release stalled authentication/disconnect controls. All values and endpoints are fixtures. Full optimized release and remaining file-dialog/shared-navigation checks remain pending.


## Pending actions and file drafts, 24 October 2026

Four final EN/CS desktop/mobile development browser cases pass for repository file drafts and the persistent navigation guard. Back restores the actual shell history entry; Stay retains text, unavailable writes keep drafts, and a confirmed save resumes the chosen exit. Pending actions block discard/duplicate save; guard-initiated saves also block dismissal and hide their inactive close control. External pending actions still allow Stay. Checks cover six widths, keyboard/Escape, light/dark contexts, dialog axe and busy semantics. Czech mobile/desktop captures were inspected. The initial fixture incorrectly assumed workspace tabs add history entries; the passing case uses Projects-to-workspace shell navigation.

Before the final close-control/busy-semantics adjustment, 86 Calendar, Notes, repository-link/selection and DNESKAi Lab browser regressions pass with four intentional duplicate-width skips. After that adjustment, all four new navigation cases and 63 targeted unit/component cases pass again. All provider/data writes are fixtures; no owner operation or real publication ran. The optimized app-wide release remains pending.
