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
- **C07 pending:** complete library paging and eligible rotation follow.

## Remaining batches

2. Shared titles/control variants, centered content widths and keyboard focus restoration.
3. DNESKAi topic inbox/review layout and direct Sources / Daily mix / Music access.
4. Work/Settings/Finance destination cleanup, planning filters and library card consistency.
5. Payload/query measurements and complete relevant test/build/responsive/accessibility verification.

## Environment and boundaries

The original user checkout remains separate. Application changes and tests live in the implementation checkout. No secrets are read into files or logs, no content is published, and no live configuration, spend, schema or data is changed by local tests. The Chrome extension did not respond to two inventory attempts; signed-in browser checks remain pending while local fixture tests continue.

Database work follows the current [function/invoker guidance](https://supabase.com/docs/guides/database/functions) and [PostgREST filter guidance](https://supabase.com/docs/reference/javascript/or). The public changelog was checked on 23 October; the reviewed TLS and server-adapter notices require no change to this project’s existing JS/SSR client for these fixes.
