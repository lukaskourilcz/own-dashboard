# DNESKAi Apify research

The research plan and runner are local preparation. Research is off and the owner has not approved the plan. All nine actor builds are pinned from unauthenticated public metadata observed on 22 October at 02:45 UTC; [the receipt](dneskai-apify-build-pins.json) records the actor/build IDs, build numbers and source URLs. Only metadata GETs were made, with no token or account access. No actor was run by this work. The migration has not been applied to any connected database.

## Plan and budget

`src/lib/marketing/dneskai-apify-research-plan.ts` defines the target lists, actor contracts, waves, dates, result volumes and per-run caps. Its item caps total $126 under a separate $150 pool. Each run is at most $5. The remaining $24 is contingency; using it needs a changed plan and new approval. The recorded prices and promotional expiry are dated account evidence from 22 October, not a promise of future prices.

Before a paid run the owner must approve the exact plan after real actor builds are pinned. A build, target, cap, volume or date change changes `dneskaiResearchPlanId(plan)`. Keep both `MARKETING_DNESKAI_APIFY_RESEARCH_ENABLED` and `MARKETING_DNESKAI_APIFY_RESEARCH_APPROVED_PLAN` unset until then. The first must equal `true`; the second must equal that full plan id. The existing `APIFY_TOKEN` remains server-side.

This plan runs between 23 October and 21 November 2026, with per-item windows and a daily run index bound to its Prague date. An expired window is a refusal, not permission to move the task to another date.

## Ledger

`20261022013957_dneskai_apify_research.sql` adds a private research ledger and service-only reserve, mark and spent RPCs. An advisory transaction lock serializes each owner's reservations. The database caps the entire pool at $150 across all plans and dates; passing a larger ceiling fails. Changing the approved plan never resets spend. A unique owner/plan/item/run key refuses duplicate starts, including settled and ambiguous attempts.

Reserved, started and ambiguous rows count at the full run cap. A finished run counts at its reported cost, including an over-cap charge, which remains visible. Settlement is immutable; an identical repeated settlement is harmless. No reset or deletion operation exists in the runner. An uncertain start retains its cap and cannot be retried automatically. Manual cost reconciliation requires verified provider evidence and owner authorization.

`createSupabaseResearchLedger` adapts these RPCs to the runner. Both reserve and mark use the service role on the server. Browser roles have no ledger access or execution grants. The public metrics table permits own-only reads, with service-only inserts and an owner/reservation foreign key.

Production's migration history differs from the repository. Reconcile that history under a separately approved release before applying this new migration. Do not run `db push` on the linked project as a shortcut. No historical file, pilot reservation or pipeline budget is changed here.

## Running and checking

`startDneskaiResearchRun(request, dependencies)` is a server module, not a scheduler or public endpoint. No timer mounts it. A caller must supply the authenticated owner, item key and zero-based run index. Derived-target tasks also need bounded targets from the earlier approved wave. The runner passes `maxTotalChargeUsd`, `maxItems`, a pinned build and disabled restart to Apify, and never retries a start.

Set `dryRun: true` to get the actor, cap, result limit, input and blocking gates without touching the ledger or network. It works with the committed disabled/unapproved plan. [The review copy](dneskai-apify-research-plan.txt) includes the resulting exact plan id, build pins and caps. Any future pin update changes that id and needs a new approval. Unit tests exercise this with synthetic data:

```bash
./node_modules/.bin/vitest run tests/lib/dneskai-apify-research-plan.test.ts tests/lib/dneskai-apify-research.test.ts tests/lib/dneskai-apify-research-database.test.ts tests/lib/marketing-codes.test.ts
```

`settleDneskaiResearchRun` reads an existing run and settles only a verified identity with a reported cost. Missing cost stays reserved. Reading a run does not start or repeat it. Binding errors and ambiguous responses need investigation before any next start.

## Research data

`researchInstagramMetric` discards captions, comments, image URLs and unknown account handles before persistence. It keeps public count observations, post identity, slide count, caption structure, CTA class and music presence. Hidden likes and missing views/shares remain null. Public counts do not establish reach, saves, completion or causal performance. No Insights scope is requested.

`marketing_dneskai_research_metrics` stores one snapshot per reservation and public post. It rejects unlisted feature keys and cross-owner reservation links. Store only the normalized derived features; never write actor dataset rows directly. Dataset ingestion and comparative month-end analysis must use actual approved run outputs. No research results or captions have been fabricated to fill the table.

Tracing contains codes, counts, costs and hashes only. Targets, usernames, URLs, caption text and credentials never enter traces. Do not log raw request or response objects.

## Pipeline isolation

The research runner does not read or alter `MARKETING_DNESKAI_APIFY_ENABLED`, the pipeline's actor binding, its $0.04/profile cap or $0.25/Prague-day budget. Research approval is not publishing approval. No source account is added to the production registry and no material is copied into DNESKAi output.

## Month-end review

After authorized collection, compare format, slide density, first-line structure, CTA class, music presence and posting hour using dated snapshots. Keep hidden and unavailable metrics separate. Link public examples and describe patterns in original wording. Record sample size, missingness and collection dates; associations do not prove a winning kit or posting slot. Actual @dneskai outcomes depend on the separately approved publication pilot and data access.
