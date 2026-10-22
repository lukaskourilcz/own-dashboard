# Claude Code continuation after the DNESKAi release

The owner authorized merging and pushing all completed work to main on 22 October 2026. OwnDashboard's production Git deployment is enabled. Quorum deliberately disables Git deployments; preserve that guard. The release/deployment receipt and exact remote SHAs are in `/Users/lukasbarsinbars/Developer/dneskai-audit-handoff/CLAUDE-CODE-HANDOFF.md` and the latest LOG.md entry.

Read CLAUDE.md, AGENTS.md, NEEDED.md, this report folder's `continuation-status.md`, `findings.md`, `gaps.md` and `continuation-verification.json` before extending the work. The historical audit remains evidence; its full backlog is not complete.

## Completed

- Audit: all 17 maps verified; 237 source findings, 189 kept, 48 excluded, 134 merged findings. Findings/gaps/cost model, a 37-example reference board and carousel playbook are committed. Czech comments were posted on #128–#144; receipts are committed. No issue was closed.
- Pipeline: all eleven selected quick fixes are implemented. They cover instruction-shaped injection filtering, definite Apify start rejection settling at zero, conservative token input checks, whole-number matching, richer evidence preparation, future lapsed-report release SQL, carousel URL order/deduplication, bounded safe image redirects, UTC/Storage test isolation, concurrent free reads within the existing tick budget and corrected operations docs.
- Design Lab: mounted today/tomorrow queue, saved-pixel stage, fit-only inspector, crops/media tray, exact-hash single and per-item batch approval, dirty-edit protection, keyboard/deep links/mobile, and real synthetic fixture rendering. Public guest Lab is read-only. The previous List stays reachable. No new approval/time/reminder/retention policy was chosen.
- Quorum: additive Editorial kit contract, look/flow/metrics support, named-kit API, font/glyph coverage and six deterministic specimen decks (24 slides). Original 11 DNESKAi golden hashes and 30 family hashes are preserved. Only Editorial is registered. OwnDashboard's vendored studio remains pinned to its existing version.
- Apify: disabled, unmounted runner; $126 plan within a separate $150 owner-wide cap; atomic ledger/metrics migration; nine verified public build pins, exact review copy and EN/CS codes. No actor ran and no research observations were invented.

## Deployment compatibility and pending SQL

Production migration history differs from repository filenames. Do not run db push, apply migrations, repair history or write to production without the owner's separate authorization. Production Supabase access remains SELECT-only through MCP.

`DNESKAI_RICH_EVIDENCE_ENABLED` defaults off. The app then avoids the new article_text column and evidence RPC and writes strict brief/1. Existing brief/1 and brief/2 documents remain readable. After approved reconciliation and both evidence migrations, the owner can enable this server-only variable and redeploy. Do not enable it first.

Prepared, unapplied migrations:

- `20261022013957_dneskai_apify_research.sql`
- `20261022020702_dneskai_richer_brief_evidence.sql`
- `20261022020759_dneskai_brief_v2_compatibility.sql`
- `20261022021835_dneskai_release_lapsed_reports.sql`
- `20261022110000_marketing_requeue_unpublished_publication.sql` (approval-04 owner re-queue; also needs `MARKETING_PUBLICATION_REQUEUE_ENABLED=true`, default off)

The lapsed-report release behavior requires its migration; no historic records were reset. Research also requires its migration and exact plan approval, independently of deploying this code. Plan ID: `a4c1458a8327aace893915734aff52c115ce417d5b250ec8d6ce8d33bfcf9438`.

At 07:34 UTC on 22 October, a read-only production query found latest migration 20261021125123, zero DNESKAi account rows, one skipped brief (`brief-slot-passed`) and three pending (`account-unavailable`) for today. Account verification remains the urgent owner prerequisite; deployment alone cannot unblock generation.

## Remaining scope

Proceed with decision-free items from the audited backlog after checking they remain reproducible. Preserve the current register, hashtag cap, cost ceilings/reservations, account/scopes and publishing switches. Owner choices remain in NEEDED.md: copy register/hashtags, research plan approval, cost policy, approval/time/reminder/retention policy, four distinct kit designs, magazine versus clipping naming, consolidation, agency-photo credits and migration history. Do not build four Editorial copies and claim five designs.

No new accounts, paid runs, OAuth scopes, live post publishing, production SQL writes or consolidation were authorized by the merge/push request. Do not rerun paid providers to prove deployment.

## Release validation

OwnDashboard: lint, TypeScript and ordinary production build exit 0; full unit run 2,129 passed / 1 skipped; final strict-v1 flow assertion 8/8; fresh full Playwright run 168 passed / 72 skipped / 0 failed (6.2 minutes). The skipped cases remain unverified. The Linux-only render-trace script fails on macOS because it expects libvips .so; the release receipt must distinguish this from the Linux CI result.

Quorum: studio 710/710, orchestrator 3,235/3,235 and site 1,062/1,062 pass in the full release check. Before that check, workspace lint/types/build passed and the production smoke covered 63 routes and 463 internal links. Use the exact deploy:check receipt for the release commit before a manual production deployment. No new model/data call is needed for verification.
