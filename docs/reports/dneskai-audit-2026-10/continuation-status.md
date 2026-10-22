# Continuation after the audit

The maps and findings are preserved as evidence at the audited commits. They are not rewritten to make historical measurements look current. This local integration branch combines the audit, eleven selected quick fixes, the disabled research runner/ledger preparation and the Design Lab prototype. Nothing here marks them deployed.

| Audit reference | Local continuation | Practical limit |
|---|---|---|
| C2 | Instruction-shaped injection filter; ordinary AI vocabulary survives | Untrusted source content stays untrusted |
| C4 | Definitely refused starts settle at zero | Unknown starts/polls retain their cap; historic ledgers untouched |
| GEN-01, cost-11 | Brief offers/input checks use bytes/2 plus token overhead | Conservative heuristic, not a true tokenizer; dollar reservation and all ceilings unchanged |
| GEN-09 | Whole numeric tokens and normalized grouping/decimal/percent notation | Date-as-evidence policy unchanged |
| C1, briefs-02, M-03 | Encoded RSS, bounded fetched prose and publisher image descriptions reach brief/2 and the offer | Metadata is not vision or a transcript; migrations unapplied and rich evidence defaults off until approved SQL rollout |
| briefs-04 | Future lapsed, never-generated briefs release eligible selected reports | No historical cleanup; jobs, revisions, coverage and other active briefs retain protection |
| M-06 | Child URLs precede fallback renditions and deduplicate before the ten-URL cap | Ten-reference cap remains |
| M-09 | Publisher/CDN redirects recheck policy and public DNS/TLS pins per hop | Two image redirects; no arbitrary-host or private-address access |
| C10 | Up to three free reads overlap within five operations and 45 seconds | Paid stages remain serial; no larger budget |
| TESTS-01, TESTS-02, SCHED-14 | PGlite uses UTC and component tests get explicit browser Storage | Node version remains a separate tooling choice; production migration parity is not implied |
| review-01, review-13, review-14 | Mounted Lab, 390 px stage/full-size view, inspector, exact-hash actions, batch outcomes and authentic fixture edits | Only Editorial; existing edit contract; no paid regeneration, reminder or late-slot policy |
| REN-01 | `POST /api/marketing/dneskai/preview` renders one draft slide in memory with the vendored studio ($0, no storage write, no revision, no hash; owner-only, 60/min, 8 s abort budget); the Lab shows changed slides as a marked, unapprovable preview | Preview is a downscaled WebP; approval still binds a saved revision's hash and stored JPEGs |
| review-10 (decision-free part) | Edit contract adds variant changes, type moves the pictures' capability flags allow, and slides inserted from unused pictures of cited sources (code sets credits); shared by save, preview and harness; `dneskai-slides/1` unchanged | No kit switch (only Editorial), no uploads (provenance decision), no per-slide kits; an inserted picture does not add a sources-slide thumbnail |
| SCHED-07, C11, weekly/worker documentation | Code-backed documentation corrected, historic pilot evidence retained and labelled | Production remains separately dated |

The upstream kit branch contains the additive Editorial contract, look/flow/metrics support, a named-kit API, coverage gates and six deterministic specimen decks (24 slides). Its original golden hashes remain unchanged. Four distinct designs and their sheets await the owner's design/naming choice; the studio has not been consolidated or re-vendored.

The research runner remains off. Its private ledger reserves atomically against a separate $150 owner-wide cap; unknown costs consume the reservation. Nine build pins were resolved using unauthenticated public metadata only; their receipts and the exact plan review copy are committed. The plan, rollout and all paid runs still need approval. No research observations or month-end findings have been manufactured.

## Production snapshot

A Supabase MCP SELECT on 22 October 2026 at 02:39 UTC returned zero DNESKAi account rows and latest migration `20261021125123`. No credentials, remote account IDs or private source text were queried. No write or migration was performed. A second SELECT confirmed all four 22 October briefs are pending with `account-unavailable` and no jobs. Their Prague slots are 08:00, 12:30, 17:00 and 20:00; the first 30-minute lead boundary is 07:30. They still need account registration before their lapse boundaries. Migration-history reconciliation remains a prerequisite to applying the prepared SQL. The code can deploy first with `DNESKAI_RICH_EVIDENCE_ENABLED` unset/false: it omits the new column/RPC and keeps the brief/1 writer. After both evidence migrations are applied in an approved rollout, enable that server-only variable and redeploy.

## Remaining owner choices

NEEDED.md retains the register/hashtag policy, research plan, ceilings, approval/time/reminder/retention policy, four kit designs and magazine/clipping naming, consolidation, agency-photo credits and migration history. Registering the existing @dneskai account is the immediate operational prerequisite. The broader audit remains a prioritised backlog; the eleven selected quick fixes and prototype do not claim to resolve every finding.

Final results are in [continuation-verification.json](continuation-verification.json) and the handoff LOG.md: full unit replay 2,126 passed/1 skipped, current focused UI 21/21 (including one new regression), lint/types clean and optimized build clean. Browser case identities across the full run and targeted fixes yield 168 passed, 72 skipped and no unresolved failure. Skipped checks are not claimed as verified.

## Owner recovery actions (22 October, afternoon)

Branch `fable/large-recovery` adds the decision-free parts of C3 and briefs-07. In DNESKAi → Zdroje the held reports are grouped by reason (topic, repeat, usefulness, date, cost, other) and each has **Re-review**, which returns it, open and unclassified, to the next nightly Jev review. A brief whose admission failed offers **Retry**; a brief that lapsed before admission offers **Move to next free slot** (today or tomorrow, same member hash, no later expiry) and **Release reports**. Retry and reslot leave the brief `pending`; the scheduler admits it through the ordinary path, now also for an older run with a pending brief. The Design Lab queue links to Sources.

Re-review is not approval and does not bypass Jev; no action admits a job, changes a ceiling or the account requirement. Retry uses existing SQL. Re-review and reslot need the unapplied `20261022141512_dneskai_owner_recovery.sql` and `DNESKAI_OWNER_RECOVERY_ENABLED=true`; release needs `20261022021835` plus the unapplied `20261022141613_dneskai_release_lapsed_brief.sql` (which refuses to apply without it) and `DNESKAI_LAPSED_RELEASE_ENABLED=true`. Both switches default off, so the deployed app never calls a missing function and shows the disabled reason instead. Not built, pending the owner: the automatic held re-queue and `generate-now`.

