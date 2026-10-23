# DNESKAi audit implementation

Started 23 October 2026 on `codex/dneskai-audit-implementation`, from audit commit `e8347f6`. The original [code/UX review](dneskai-code-ux-audit-2026-10-23/README.md) remains a record of baseline `d6f60c7`. This report tracks implementation and actual validation; proposed screenshots in the review are not completion evidence.

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

The original user checkout remains separate. Application changes and tests live in the implementation checkout. No secrets are read into files or logs, no content is published, and no live configuration, spend, schema or data is changed by local tests. The Chrome extension did not respond to two inventory attempts; signed-in browser checks remain pending while local fixture tests continue.

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
