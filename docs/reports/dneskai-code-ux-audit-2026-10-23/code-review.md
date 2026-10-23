# DNESKAi code review

Baseline: `d6f60c7271c8078713fe2f56d63bc71fe10a5692`. This review changes no application behavior or database schema. Priorities: P1 = prevent loss of owner work; P2 = incorrect or inaccessible behavior under a concrete trigger; P3 = bounded edge case or maintainability work. Performance proposals below require measurement before implementation.

## Findings

### C01 · P1 · Preserve unsaved edits across workspace and shell navigation

**Location:** `src/components/marketing/dneskai/workspace.tsx:79`, `src/components/marketing/dneskai/lab/lab-tab.tsx:43`, `src/components/projects/project-workspace.tsx:263`.

The Lab reports dirty state through an optional callback, but its parent explicitly omits that prop. The editor guards changing posts inside the Lab and document unload; switching workspace tabs unmounts the editor without either guard. The same ownership gap applies when leaving the workspace.

**Browser reproduction:** `/dev-preview?project=dneskai`, Czech, 1440 px. In the tomorrow post “Benchmark není žebříček”, replace Titulek with “AUDIT — unsaved draft test”, open Zdroje, return to Dnes ke schválení. No confirmation appears; Titulek contains its original value. See `evidence/dneskai-unsaved-before-cs-dark-1440.txt` and `dneskai-unsaved-after-cs-dark-1440.txt`. The fixture explicitly saves nothing; this reproduction traces the same editor mount boundary used by Production.

**Change:** lift dirty/draft ownership to the persistent workspace and intercept tab, project, shell and history changes with Save / Discard / Stay. Preserve a draft when an attempted save fails. Keep approval bound to the saved content hash.

**Acceptance:** edit title, caption, crop, audio and schedule; exercise each exit path; Stay retains input, successful Save retains the new revision, Discard restores saved input, failed Save stays in the editor. Cover browser Back as well as in-app clicks.

### C02 · P2 · Select pending decisions before the newest-150 read limit

**Location:** `src/lib/marketing/dneskai-workspace-read.ts:92`, priority calculation at `:115`.

The database returns the newest 150 non-superseded revisions before JavaScript prioritises undecided work and slices the result to 60. A review/returned revision older than those 150 rows never reaches the priority logic. The comment promising to keep every undecided post does not hold. This requires accumulated history; it is not evidence of a missing current Production post.

**Reproduction:** audit probe constructs 150 newer published revisions plus one older valid review revision. The review item appears when read alone and disappears with the newer rows; unreadable remains zero.

**Change:** read undecided revisions separately with deterministic ordering and explicit pagination/overflow, then fill the remaining budget from the scheduled/history window. Do not replace one silent cap with another. Push time predicates into the history read.

**Acceptance:** oldest undecided item remains reachable after 150+ receipts; 60+ pending items expose count and pagination; history cannot evict decisions; owner and brand filters remain in SQL.

### C03 · P2 · Filter job brand before limiting the result

**Location:** `src/lib/marketing/dneskai-workspace-read.ts:96`, post-read brand filter at `:147`.

The job query limits the owner's newest eligible jobs to 60 across brands. Only afterward does JavaScript reject non-DNESKAi jobs. Sixty newer jobs for another brand hide a valid DNESKAi queued/failed job in the three-day window.

**Reproduction:** audit probe returns one DNESKAi job when read alone, and zero when 60 other-brand jobs precede it. The stand-in applies the requested query filters and limit rather than returning an unrestricted fixture array.

**Change:** add the generation source brand predicate to the SQL/PostgREST read before the limit. Review the analogous cost read's cross-brand cap too. Consider a typed brand column only if plans justify a migration.

**Acceptance:** mixed-brand load cannot change DNESKAi visibility; queued/running/reconciliation and current failed work retain their existing ordering and historical exclusions.

### C04 · P2 · Aggregate engagement counts without silently truncating replies

**Location:** `src/lib/marketing/dneskai-workspace-read.ts:183`.

The workspace fetches at most 5000 raw reply rows across the selected publications, with no order or pagination, and presents their lengths as exact match/sent/failure totals. At 5001 matches the receipt and seven-day summary already undercount. A server row limit could lower that threshold; the project's live limit was not inspected. Seven-day selection occurs after this shared cap, so older publications can also consume the rows needed for newer ones. The summary means lifetime engagement on posts published in the last seven days, not replies sent in that period; keep that distinction explicit in the UI.

**Reproduction:** audit probe supplies one eligible published post and 5001 sent replies; both receipt and summary report 5000.

**Change:** use an owner-scoped aggregate query/RPC grouped by publication and status. Keep per-comment pagination separate. Either return complete counts or mark them as partial. Accumulate one map if raw rows remain necessary instead of filtering the entire array per post.

**Acceptance:** exact totals beyond 5000, multiple publications, mixed statuses, failures, empty result, own-only isolation and the documented seven-day semantics. Compare database work with realistic rows before choosing indexes.

### C05 · P2 · Give the audio form heading and title input different IDs

**Location:** `src/components/marketing/dneskai-audio-library.tsx:103`.

The upload form's heading uses `${id}-title`; the generated track-title input uses the same ID. Its label's `for` resolves to the heading, and form `aria-labelledby` also becomes ambiguous. Existing library tests check track switches and copy but miss ID uniqueness and input association.

**Reproduction:** render the real library with a synthetic empty response. The audit probe finds an H3 and INPUT sharing the ID; `document.getElementById(label.htmlFor)` returns H3.

**Change:** use separate `headingId` and field IDs. Add meaningful label association and duplicate-ID checks to form component tests in both languages.

**Acceptance:** exactly one target per ID, clicking the track-title label focuses its input, and an accessible-name check identifies every required upload field.

### C06 · P2 · Allow retrying an unchanged draft preview after a transient failure

**Location:** `src/components/marketing/dneskai/lab/lab-tab.tsx:164`–`:188`.

The preview memory stores network/rate-limit failures under the exact draft key. `remembered` then suppresses another request for that draft for the rest of the editor instance (until eviction or another edit). The failure branch even documents this behavior. The current stage offers no retry action. An owner who recovers connectivity must change content or leave/reopen the editor to retry.

**Evidence:** traced effect and stage UI; network failure was not injected into Chrome. This is a source-confirmed recovery gap, not a measured Production incident.

**Change:** retain successful previews; give transient failures a short expiry and an explicit Retry that invalidates only the failed key. Respect Retry-After and cancellation; avoid automatic retry storms or weakening approval checks.

**Acceptance:** unchanged draft recovers from offline/429/503, invalid drafts still block, rapid edits abort stale responses, cached successful previews do not refetch.

### C07 · P3 · Make the audio-library bound explicit and filter rotation eligibility first

**Location:** `src/lib/marketing/dneskai-audio.ts:48`, `:154`.

Both library and rotation read the oldest 200 tracks. Rotation filters source and enabled state after that limit. With 200 disabled or Instagram-library entries, a newer enabled uploaded track can never rotate in. Upload permits additional tracks without exposing this limit. The current ten-track library does not reach the trigger.

**Change:** filter enabled stored tracks before rotation's bound and use deterministic pagination. Paginate the management library or enforce and explain an actual product limit at creation. Never hide a track the owner can no longer manage.

**Acceptance:** 200 ineligible older tracks plus one eligible newer track; stable round-robin order; chosen disabled tracks retain their existing revision identity behavior.

## Performance and code-quality work to measure

1. **List payload versus editor payload.** `readDneskaiWorkspace` loads complete revision JSON, decks, rendered assets and brief media for up to 60 posts for Today, Calendar and Posts. Retain the shared query key, but measure compressed payload, parse cost and editor-open delay. A typed summary plus selected-post detail can reduce cold reads; avoid introducing N+1 detail calls for the calendar or losing exact revision identity.
2. **Private thumbnail derivatives.** `lab/stage.tsx:77`, `:140` and `lab/kit-tiles.tsx:28` use unoptimized full rendered images for small previews. Repeated URLs can share the browser cache; they are not necessarily duplicate transfers. Measure bytes for 10-slide posts, then use owner-scoped signed thumbnail derivatives for strips/tiles while preserving the full saved render for review. Do not proxy private media through a public cache or remove the all-slides review guard as a shortcut.
3. **Query plans before indexes.** The revision index is `(user_id,status,created_at desc)`; the reviewed read also filters brand and excludes a status. A partial owner/brand/time index might help after predicate changes, but static source cannot establish a slow plan. Use EXPLAIN (ANALYZE, BUFFERS) on a safe representative read, compare scanned/returned rows and payload size, then test writes and migration size. No index migration is proposed as an unconditional fix.
4. **Typed data access.** `Database` uses `SupabaseClient<any>` because generated types omit marketing tables. Generate schema types and add explicit read DTOs so JSON aliases, status unions and returned nullability fail at compile time. Keep runtime schemas at trust boundaries. Do not spread `as never` from audit stubs into application code.
5. **Separate editor responsibilities.** The 425-line Lab module coordinates selection, draft/dirty state, render/fit requests, media queries, mutations and dialogs. Extract a draft-lifecycle hook and preview controller with explicit transitions after C01/C06 tests exist. Avoid a broad rewrite of publisher contracts or a new global state framework.

## Existing safeguards to preserve

- Review route authenticates with `getUser`, checks the DNESKAi project through the session client, bounds the date and returns `private, no-store`.
- Workspace reads filter owner; optional engagement/topic tables stay behind their feature gates. Audio's service-role path derives the owner from authentication and includes owner predicates; signed preview URLs use a batch request, not one signing call per track.
- Audio writes reject cross-origin requests, rate-limit and validate bounded inputs; uploads check type/size/decodability and private storage ownership.
- Publisher checks exact approved/content hashes, lease state, account/credential readiness and reconciliation. Keep uncertain outcomes out of blind publish retries.
- The publication schema has `unique(revision_id,platform)`. A suspected duplicate-publication `.find()` issue was rejected after checking that constraint.
- React Query shares the review read across DNESKAi destinations and polls only while render attachment is pending. Preserve route-scoped destination loading.

## Validation and limits

`tests/audit/dneskai-review-baseline.test.tsx` contains four **baseline defect probes**, covering C02–C05. All four pass because they assert the observed defect; a passing probe is not a fixed product. Convert them to desired-behavior regression tests when implementing each fix. C01 has browser before/after evidence. C06/C07 are source-traced boundary cases.

The complete source inventory covers 155 component files, 137 marketing libraries, 37 marketing routes and 49 relevant migrations. Detailed tracing focused on the workspace, owner edits, audio, source/mix flows, scheduler/publisher boundaries and engagement reads. Inventory scanning is not a line-by-line security audit of every library. No live query plans, Production timing, database writes or external provider calls formed part of this review. See `validation.md` for executed checks and results.

Database recommendations follow Supabase's current primary guidance on [query optimisation](https://supabase.com/docs/guides/database/query-optimization) and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). The 23 October review of the public changelog identified no change that requires a schema mutation for this audit.
