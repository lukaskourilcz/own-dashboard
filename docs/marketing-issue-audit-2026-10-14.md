# Marketing and Workflows completion audit — 14 October 2026

Scope: all 11 open marketing/Workflows issues. Finance #71 is excluded by the
owner. Steps requiring an owner decision/input are held. The owner merged
PR #109; production main `d896d5b` is READY on own-dashboard-tau.vercel.app.
Its full release checks passed, including 1,398 unit tests and 126 browser
tests. This audit adds code on `codex/marketing-completion-audit`; it is not
part of that deployment until reviewed and merged.

| Issue | Verified result / remaining step |
| --- | --- |
| #93 | Parent release stays open: no exact final post approval or real publication receipt. |
| #94 | Foundation implemented and deployed; ownership, full calendar snapshots, atomic approval and recovery tested. Closure evidence posted; GitHub closure form awaits confirmation. |
| #95 | Knowledge implementation verified with 39 focused tests and real historical reconciliation. Recent Saved backfill remains #101; automatic OCR is not claimed. Closure form awaits confirmation. |
| #96 | Generation/rendering code and authored offline examples exist. Complete live assets require template/environment/budget decisions and actual final source; no quota reset. |
| #97 | EU redaction, lineage and diagnostic failures tested. Approved-content live trace and measured model comparison require a fresh pilot/owner review. |
| #98 | Persisted n8n collection path was verified. Final publisher cutover, channel access and real approved receipt remain held. Timers stay off. |
| #101 | Official Saved archive and independently checked Saved timestamp are absent; do not claim the recent 21-day import. |
| #102 | Old handoff is superseded by this audit and linked issues; its descriptions of draft PRs/unchanged production are historical. It does not prove completed publishing. |
| #103 | Workflows navigation/maps/EN-CS/accessibility verified. Current-state copy and separate web/social explanation updated; fresh six browser checks passed before the last copy clarification. |
| #104 | All 32 free-feed adapters ported with opt-in/default-bridge routing. One OpenAI native/bridge comparison matched ten items. Editorial web pipeline is retained; cutover decision remains. |
| #108 | Private-data-safe offline scoring implemented and replayed: 7/8 correct, one abstention, no false acceptance. Owner-reviewed cross-source evaluation and a new bounded live scope remain. |

## Web and social publishing

DNESKAi web keeps one daily article through the existing BoardlessAI
editorial/delivery path and its existing quality/review gates. Socials can
cover more topics. Native free-feed selection affects research collection
only; it neither writes/approves web editions nor changes final-article
lookup, Quorum schedules or web delivery. Shared Quorum jobs cannot be
retired just because social collection can move. The current content
adapter still accepts final articles; independent social briefs from other
research topics remain work under #96/#104.

## Owner input / decisions

1. Supply the official Saved ZIP locally and verify one known Saved timestamp
   for #101, or keep that import deferred.
2. Decide where the next content pilot runs after the existing staging
   cleanup; authorize one new bounded generation/evaluation scope. Old
   consumed attempts, unknown consumption and reservations remain retained.
3. Review the exact graphic layouts for production and the separate Story
   layout if Stories return to scope. Staging template approval is limited
   to staging and does not approve final posts.
4. Choose a native social-feed cutover/rollback window; retain the one daily
   web article and its shared Quorum triggers. No cutover is activated here.
5. Decide whether to connect Threads and Insights with their separate
   permissions. Existing Instagram basic/publish access does not grant them.
6. Approve each finished exact revision in OwnDashboard, then explicitly
   permit a live publication test and later daily activation. Until then,
   collection schedules and publishing stay off.

GitHub may require interactive confirmation to close issues or create a PR.
The #94/#95 forms are pending; their state changes are not claimed complete.
No secrets, source payloads or private exports are included in this report.

## Combined verification

On the final code tree: lint, TypeScript, production build and diff checks
passed. Full unit suite: 1,427 passed, one configured skip. Full browser
suite: 126 passed, 70 configured skips; desktop/mobile, EN/CS and accessibility
coverage includes Workflows and DNESKAi Sources. No skipped scenario is
claimed verified. Public native/bridge comparison was read-only. Production
collection still returned HTTP 403 `collection-disabled` after PR #109.
No new Claude/Jev/Apify call, cloud variable change, DB migration/write,
web edition delivery, schedule activation or social publication occurred.
