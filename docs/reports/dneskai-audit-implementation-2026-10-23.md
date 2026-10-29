# DNESKAi audit implementation

Started 23 October 2026 on `codex/dneskai-audit-implementation`, from audit commit `e8347f6`. The original [code/UX review](dneskai-code-ux-audit-2026-10-23/README.md) remains a record of baseline `d6f60c7`. This report tracks implementation and actual validation; proposed screenshots in the review are not completion evidence.

## Completed locally

All five batches are implemented: C01–C07 are fixed, and U01–U16 are mapped below. Changes are committed in `/Users/lukasbarsinbars/Documents/own-dashboard-audit-20261023` on `codex/dneskai-audit-implementation`. The original checkout and its unrelated application changes remain intact. Nothing has been pushed, merged or deployed.

Open the [actual before/after comparison](dneskai-code-ux-audit-2026-10-23/implementation.html), [exact validation record](dneskai-code-ux-audit-2026-10-23/implementation-validation.json) or [Claude kickoff](dneskai-code-ux-audit-2026-10-23/claude-kickoff.md). The comparison contains seven pairs and 22 actual captures with hashed provenance; original proposals remain in the historical review.

| Required check | Final result |
|---|---|
| `npm run lint` | Passed. |
| `npx tsc --noEmit` | Passed. |
| `npm run test` | **2,779 passed, 1 skipped**; 273 files passed, 1 skipped; 185.27 s on the final application tree. The existing opt-in independent-session PostgreSQL pilot test has no configured local container. Migrated PGlite database tests ran. |
| `npm run build` | Passed, optimized local fixture build with `NEXT_E2E=1` and placeholder public configuration. |
| `npm run test:e2e` | **247 passed, 79 skipped**, 8.2 min. Skips are the suite's project-specific duplicate/once-only cases, including the six-width matrix on the second project. No failing browser cases remain. |

The browser run covers 25 visible destinations at 360, 430, 768, 1024, 1440 and 1728 px (150 states), with one visible title and no document overflow. English/Czech and light/dark are sampled rather than exhaustively combined. Existing axe checks, new Settings scans at six widths, keyboard/focus checks, canonical Back/Forward, draft Save/Discard/Stay, unchanged failed-note retry, DNESKAi approval/media flows, install metadata and the Czech one-page A4 invoice passed. All 24 macOS visual baselines passed in the full run; the two changed and ten new captures were reviewed.

The application source and optimized build match `e7eead8`; later commits affect documentation, its contract tests and verification artifacts. Earlier counts and pending-check statements in the development record below describe intermediate runs; the table above is the final result.

### Deployment and verification limits

Apply **`20261023135551_dneskai_engagement_receipts.sql` before deploying this code**. It is the only new audit migration. The earlier 23 feature migrations through `20261023130300` were already applied under owner authorisation; do not repeat that rollout. NEEDED.md, README, the migration guide and system map distinguish the completed rollout from this pending additive function.

No Production data/configuration, publishing, provider calls or spend changed during this implementation. Secrets remain outside the code/report. The Chrome extension timed out on three inventory attempts, so browser evidence uses isolated Chromium and synthetic `/dev-preview` fixtures. No manual screen-reader audit or actual 200–400% browser zoom check is claimed. Local reflow, axe, keyboard and PostgreSQL evidence does not certify live latency, data cardinality or the automatic Reel publisher. Summary/detail reads, private image derivatives and an additional index remain measured experiments for the reasons recorded in Batch 5.

## Development record

The following intermediate checks explain the changes and repairs, not additional release claims.

## Batch 1: protect work and correct reads

- **C01 implemented:** one dirty-draft guard above the persistent shell handles workspace tabs, post selection, project/sidebar/command navigation, ordinary links, document unload and managed browser Back/Forward. In-app exits offer Save / Discard / Stay. A failed save retains the editor and pending navigation; successful save resumes that navigation. Browser history restores the current entry without adding entries or dropping forward history. Native reload/close retains the browser's standard unsaved-work warning.
- Guard validation: five component tests passed, covering Stay/Escape, Discard, failed-save retry, readiness changes, SPA link replay and Back restoration. The existing thirteen DNESKAi workspace component tests also passed. Focused lint and type checking passed during development; full release checks follow the remaining batches.
- **C02 implemented:** pending decisions have a separate owner/brand/status-filtered SQL read, stable created-at/id cursors and 30-row pages. Recent receipts cannot evict them. The Lab also shows pending dates outside today/tomorrow. Paging is guarded for dirty drafts, survives reload in the URL and resets after a saved successor. The 60-post response and 150-row recent-context bounds remain explicit.
- **C03 implemented:** workspace and cost job reads filter the generation source brand before their row limits.
- Read validation: sixty targeted tests passed across the read/API/client/Lab/component files, including 75 decisions with tied timestamps across three pages, an old decision beyond 150 newer receipts, mixed-brand job starvation, and malformed/oversized cursor rejection. Type and focused lint checks passed.
- **C04 implemented:** `marketing_dneskai_engagement_receipts` returns one complete owner-scoped JSON aggregate, with at most 60 selected receipts and a seven-day summary independent of the current review page. It counts all matching rows and keeps the complete failure count separately from the ten displayed codes. Actual publication events determine the rolling window, with schedule time as fallback. Missing/malformed aggregate data displays an unavailable state rather than zero.
- Aggregate validation: 29 targeted tests passed, including five tests on every migration in isolated WASM Postgres. The SQL tests cover 5,013 matches, twelve failure codes, off-page recent publications, old selected receipts, other-owner/other-brand exclusion, invoker/RLS execution, role grants and input bounds. Type and focused lint checks passed. Migration `20261023135551_dneskai_engagement_receipts.sql` was created with Supabase CLI 2.122.0 and tested locally; apply it before deploying the corresponding code.
- **C05 implemented:** the audio upload form heading and track-title input use separate IDs. The rendered-form regression checks ID uniqueness and every label target. The original four baseline probes now assert corrected behavior (C02–C05); the audit folder’s historical test counts still describe the review baseline.
- **C06 implemented:** valid drafts whose preview failed offer an explicit retry without a text edit. Numeric and HTTP-date `Retry-After` cooldowns disable retry until allowed; successful cached previews and validation refusals keep their existing behavior. Twenty-two targeted client/workspace tests passed, including an unchanged-draft retry and no automatic retry during cooldown. Focused lint and type checking passed.
- **C07 implemented:** stable 200-track management pages expose Load more in the library and picker. The format switch shares the same cached first read. A saved disabled/off-page selection is looked up by owner and ID and never silently becomes Automatic. Upload confirmation reads its new ID directly. Rotation filters enabled stored tracks in SQL, seeks by created-at/id and wraps with constant-size reads; it has no 200-track population cap. Forty targeted tests passed, including real PostgreSQL with 401 tracks, 200 older disabled tracks, tied timestamps, off-page selection, paging and owner isolation. Focused lint and type checks passed.

## Batch 2: shared consistency

- The shell explicitly owns the page title; standalone PageHeaders still render their own title. Descriptions and actions remain visible at all widths instead of being hidden by a positional desktop CSS selector.
- The content area uses the centered page frame, with bounded settings/form utilities for the next batches. Icon buttons align with ordinary desktop fields; workspace tabs retain 44 px mobile hit areas.
- The command palette now uses the shared modal primitive (focus trap, inert background and Escape), restores its opener and derives destinations from the sidebar registry and owner visibility preferences, including Competition. Mobile More explicitly restores its opener.
- Eleven targeted header/navigation tests passed. Focused lint and type checks passed. Chrome extension reconnection timed out again; keyboard geometry and responsive checks will run through the repository’s isolated fixture browser, with the signed-in Chrome limitation recorded.

## Batch 3: DNESKAi workflow

- Selected revision, state, real preview and inspector precede the bounded topic inbox. The toolbar links to topics; topic counts and keyboard decisions remain available. Mobile keyword controls meet the shared touch size.
- Sources / Daily mix / Music have direct URL-backed local tabs. Only the selected section mounts its code and reads. Sources supports local search/kind filtering, counts, compact rows and retry. Daily mix uses a centered 960 px maximum form with aligned desktop controls, 44 px mobile labels/fields and adjacent announced validation. Its unsaved edits use the navigation guard.
- Music upload opens in a shared dialog with one title. The Instagram dialog removes its repeated heading and discloses connection detail on demand. Reel music is conditional on Reel format; single-image drafts explain the carousel requirement. Publish/return/skip are separated from save/approve without changing their safeguards.
- Seventy-one existing targeted workflow tests passed; the final focused rerun passed 47 tests, including EN/CS source filtering and corrected modal field associations. Type and focused lint checks passed. Daily mix/Music end-to-end tests now use their direct URLs; complete browser checks follow.


## Environment and boundaries

The original user checkout remains separate. Application changes and tests live in the implementation checkout. No secrets are read into files or logs, no content is published, and no live configuration, spend, schema or data is changed by local tests. The Chrome extension did not respond to three inventory attempts; browser verification uses isolated Chromium instead of the owner's signed-in session.

Database work follows the current [function/invoker guidance](https://supabase.com/docs/guides/database/functions) and [PostgREST filter guidance](https://supabase.com/docs/reference/javascript/or). The public changelog was checked on 23 October; the reviewed TLS and server-adapter notices require no change to this project’s existing JS/SSR client for these fixes.


## Batch 4: destination cleanup

Work uses content-driven column heights, with upcoming dates and shipped work below attention rather than a stretched empty card. Settings uses a centered 896 px frame, section anchors, a stable label/control grid, consistent touch/desktop segments and stable drag-context IDs. The financial and creation-form changes are being verified in the same full type/lint/unit pass; browser geometry follows.


### Finance and planning destinations

Accounts starts with balances/accounts and bank connection controls. Transactions starts with search, kind/account filters, count and a stable newest-first list with explicit Load more; import/reconciliation is an on-demand disclosure. Categories starts with rules and its category breakdown. The Money overview and financial math remain separate and unchanged. Account/transaction creation opens a dialog. Goals, Dates, subscriptions and Calendar also open existing creation forms on demand, leaving records/boards in the default space. Subscription renewal dates, classification and amount evidence remain visible; failed subscription saves retain the draft. Mobile task filters move into an opener-restoring dialog with active count, result count and clear-all. Type and full lint checks passed during development; the complete unit/browser suite is the next gate.


### Libraries and interaction continuity

Prompt cards have one preview/copy entry point, consistent headers and a full exact-text preview in the existing composer dialog. Tools keep aligned headers and footer actions. Links no longer repeat their canonical URL as another action inside expanded detail. Notes opens its list first on mobile, has a full-size Back control, moves focus between list/detail, and shows failed autosave with Retry instead of a false Saved state. Autosaves are serialised and only successful documents enter the saved cache. Career count sits beside freshness/refresh; opportunity-gate copy identifies Tugedr as an opportunity source. The shared dialog now also restores openers for controlled form dialogs without a Trigger.

The complete unit suite passed **272 files / 2776 tests**, with one existing skipped file/test, using four workers (92.24 s). This uncovered migration-guide omissions and dictionary ordering, now corrected. Full lint and type checking also passed during development. The unbounded initial unit attempt was interrupted after diagnostics; four workers are now the configured default to keep isolated WASM databases within machine resources. End-to-end and visual verification are still pending.


## Batch 5: measured performance and code quality

- The read port now uses nine database table models generated from the entire local migration chain, including nullability and foreign keys. Revision/publication/brief DTOs derive from those models; runtime schemas still validate JSON and status semantics. The generator deliberately exposes no inserts/updates through this read-only port. Regenerate with `node --experimental-strip-types scripts/generate-dneskai-read-types.mjs`; it never connects to Production.
- Draft state/dirty identity/fit requests and the bounded render-preview cache/cooldown/retry controller now live in separate hooks. The Lab keeps decisions and approval UI. Thirty-six targeted regression tests passed after extraction; fifty read/loading/migration/dictionary contract tests also passed. Type and lint checks passed.
- Focused finance routes load 4, 6 and 3 central data families respectively (Accounts / Transactions / Categories), down from 9 each. Invoice records remain loaded on Transactions for reconciliation; unrelated project costs, cron records and allocation rows no longer load on these destinations.
- [Local measurements](dneskai-code-ux-audit-2026-10-23/implementation-performance.json): the 60-post fixture is 251,449 raw bytes / 21,638 gzip bytes / ~0.50 ms median local parse. A summary-only experiment is 23,642 raw / 1,876 gzip / ~0.041 ms, but repeats fixture content and does not measure editor-open latency. Keep the shared read for now: a split API needs unique-content/network measurements and must avoid calendar N+1 calls.
- A real 1080 × 1350 fixture slide is 50,113 bytes; a 192 px WebP experiment is 3,152 bytes (~94% smaller). No derivative is used as approval evidence. Current strips intentionally load full images to establish readiness; replacing them with thumbnails would weaken that check. A separate private derivative contract needs a full-image readiness path before rollout.
- On a disposable 25,000-row PostgreSQL dataset, the existing pending-decision plan took 2.162 ms versus 0.089 ms with a 221,184-byte partial owner/brand/time/id index. These are warm WASM-local measurements, not Production timings. The existing read is already inexpensive in this fixture; no unconditional index migration is shipped without live cardinality/write-cost evidence. Both plans and the synthetic owner-isolation check are recorded.

Browser verification, reviewed screenshots and the final complete release commands follow below.


### Browser-driven refinements

The first optimized-build browser pass confirmed the new guard, direct local tabs, all six reflow widths, one visible title and Settings axe checks. Screenshot review tightened mobile Settings anchors into one scrolling row, kept short preference controls beside labels, changed sparse prompt categories to masonry and restored visible touch actions. Finance filter defaults now name kinds/accounts explicitly. The first Lab pass found a real light-theme success-badge contrast failure (4.44:1 on the inset canvas); the semantic success text token is darkened before rerunning axe. Tests that assumed exactly two Lab dates now scope generated-job checks to their actual day and choose an enabled day-approval button. Pending decisions outside the original window remain reachable.


Sparse client rows now show related-record counts inline, omit zero-count blocks and keep a single meaningful empty relationship label. Their layout stacks before the constrained tablet content area. The responsive matrix covers all 25 visible destinations; hidden Inbox/References policy is retained.


The canonical-route Back test exposed listener ordering that the synthetic history test did not model: a descendant passive history listener could remove the draft before the guard observed it. History and draft registration now use layout effects, before passive shell subscriptions. The desktop browser regression verifies restored URL/draft, unchanged history length, Discard resuming Back and working Forward; Notes’ unchanged failed-save retry is also exercised against a forced transient response. Five focused guard tests, type checking and lint passed after the correction. Mobile and the full optimized-build run remain the final verification gate.


Four actual-browser regressions now pass for canonical Back/Forward and unchanged failed-note retry on desktop and mobile (12.3 s, local dev build). The latter exposed a cramped mobile Notes header: title/save status now form their own row and secondary controls wrap below, so the failure remains visible. The navigation helper also waits for the selected language’s primary button instead of checking its count during hydration. Final optimized-build verification follows.


Direct Daily mix/Music destinations now show a named disabled state when their server feature is off, rather than a blank tab. Daily mix also exposes loading and explicit read Retry; section chunks use one loading message. The embedded components retain their existing hidden-when-off default for other callers. Twenty-four targeted component/documentation tests passed, including the two direct-destination disabled-state cases; focused lint and type checks passed.

The final optimized fixture build, full lint and standalone type check passed. The six macOS visual tests passed after updating their navigation-dialog action to the shared translated label. Two desktop Lab captures changed; ten new stage captures cover the older pending fixtures now reachable through the corrected queue. Every changed/new PNG was visually reviewed. The full browser and unit suites are running separately; updating snapshots alone is not their completion evidence.

The concurrent full unit run finished with 2,777 passes, one existing skip and two timing failures: a source test assumed its asynchronously loaded form existed after 50 ms, and a changelog assertion spent its timeout importing the full fixture module. The source test now polls for the actual form/success announcement; the changelog fixture loads with the test module. Both retain their original behavior assertions. Their focused rerun passed all nineteen tests; the complete unit suite will be rerun after the browser workload.

The final documentation pass also corrected the migration guide's old “unapplied” paragraphs and five contract assertions that encoded that historical state. The assertions now require the recorded 23 October schema rollout date while retaining every RLS/private-bucket/service-role check. Documentation/migration contracts passed all 26 tests, followed by the full 2,779-pass unit run above. The new aggregate remains explicitly unapplied.

Ready-content screenshot review found a subscription grid whose intrinsic minimum width could extend cards beyond the mobile content area while the outer shell hid document overflow. The grid tracks and cards can shrink to the available width, and renewal amounts wrap below their dated record on narrow screens. Period controls meet the mobile touch size; cancelled labels no longer nest a paragraph inside a paragraph. New browser assertions check each card's bounds and internal scroll width after the chart settles. Six development-browser width cases and 48 financial unit regressions passed. The optimized build and complete release suites were rerun after this correction and passed at `e7eead8`, as recorded above.

## UX recommendation map

| Audit ID | Implemented treatment / retained boundary |
|---|---|
| U01 | Selected revision before the bounded topic inbox; real saved pixels remain the approval surface. |
| U02 | URL-backed Sources / Daily mix / Music sections, search, source-kind filtering and compact rows. |
| U03 | Centered 960 px maximum mix form; paired control heights, labelled mobile groups and adjacent validation. |
| U04 | Attention card follows its content; upcoming dates and shipped work use the freed column. |
| U05 | Centered 896 px settings grid and section anchors; short preferences retain nearby controls. |
| U06 | Accounts, Transactions and Categories have focused landings and route-specific data needs; Money retains the overview. |
| U07 | Explicit shell title ownership; descriptions/actions survive without duplicate mobile headings. |
| U08 | Shared desktop heights and 44 px mobile controls/tabs; no forced equal height for unrelated content. |
| U09 | One upload-dialog title with unique form IDs; account detail disclosed from a compact connection summary. |
| U10 | Save/approve separated from publish/return/skip; conditional Reel music, format guidance and explicit preview retry. |
| U11 | Mobile filter dialog with counts/clear-all; Calendar, Goals and Dates creation forms open on demand. |
| U12 | Shared palette modal traps/restores focus, uses canonical destination visibility and includes Competition; More restores its opener. |
| U13 | One prompt preview/copy entry, masonry categories, aligned tool actions, no duplicate expanded-link action; Notes has mobile list/detail and persistent failed-save retry. Existing library evidence/project associations remain. |
| U14 | Career freshness/refresh beside count, explicit Tugedr opportunity source, compact client relationships without zero-count KPI blocks. Existing fit/detail behavior remains. |
| U15 | Subscription creation on demand and visible renewal/classification; finance/project touch controls align. Invoice calculations, legal details, QR and print layout remain unchanged. |
| U16 | Shared centered page/settings/form frames, content-sized panels, explicit disabled/read-error/loading states and recovery. Empty space is not filled with invented content. |


## Final artifact checks

The comparison was rebuilt from the final passing browser run: seven before/after pairs, 22 actual application PNGs and 77 local references, with SHA-256 and separate CSS viewport/PNG pixel dimensions. All 22 captures were visually reviewed; the subscription/editor captures wait for finished content. The original review verifier also passes (74 baseline captures, 155 source paths, 27 destinations and four reading pages).

The implementation page passes its own 1440 px dark and 360 px light browser checks: all 36 comparison/gallery images load, no asset errors or document overflow, one heading, working anchors and zero axe violations. Two report-layout screenshots are stored separately. Rebuild/verification commands and limits are in the audit folder's README and validation JSON. The branch contains meaningful local commits; it has not been pushed, merged or deployed.
