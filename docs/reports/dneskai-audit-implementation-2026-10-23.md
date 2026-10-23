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

## Remaining batches

## Batch 3: DNESKAi workflow

- Selected revision, state, real preview and inspector precede the bounded topic inbox. The toolbar links to topics; topic counts and keyboard decisions remain available. Mobile keyword controls meet the shared touch size.
- Sources / Daily mix / Music have direct URL-backed local tabs. Only the selected section mounts its code and reads. Sources supports local search/kind filtering, counts, compact rows and retry. Daily mix uses a centered 960 px maximum form with aligned desktop controls, 44 px mobile labels/fields and adjacent announced validation. Its unsaved edits use the navigation guard.
- Music upload opens in a shared dialog with one title. The Instagram dialog removes its repeated heading and discloses connection detail on demand. Reel music is conditional on Reel format; single-image drafts explain the carousel requirement. Publish/return/skip are separated from save/approve without changing their safeguards.
- Seventy-one existing targeted workflow tests passed; the final focused rerun passed 47 tests, including EN/CS source filtering and corrected modal field associations. Type and focused lint checks passed. Daily mix/Music end-to-end tests now use their direct URLs; complete browser checks follow.

## Remaining batches

4. Work/Settings/Finance destination cleanup, planning filters and library card consistency.
5. Payload/query measurements and complete relevant test/build/responsive/accessibility verification.

## Environment and boundaries

The original user checkout remains separate. Application changes and tests live in the implementation checkout. No secrets are read into files or logs, no content is published, and no live configuration, spend, schema or data is changed by local tests. The Chrome extension did not respond to two inventory attempts; signed-in browser checks remain pending while local fixture tests continue.

Database work follows the current [function/invoker guidance](https://supabase.com/docs/guides/database/functions) and [PostgREST filter guidance](https://supabase.com/docs/reference/javascript/or). The public changelog was checked on 23 October; the reviewed TLS and server-adapter notices require no change to this project’s existing JS/SSR client for these fixes.


## Batch 4 progress: Work and Settings

Work uses content-driven column heights, with upcoming dates and shipped work below attention rather than a stretched empty card. Settings uses a centered 896 px frame, section anchors, a stable label/control grid, consistent touch/desktop segments and stable drag-context IDs. The financial and creation-form changes are being verified in the same full type/lint/unit pass; browser geometry follows.
