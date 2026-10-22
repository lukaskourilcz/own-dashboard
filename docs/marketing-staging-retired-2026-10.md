# October marketing staging, retired (2026-10-20)

Owner decision 9 of the DNESKAi Instagram epic [#110](https://github.com/lukaskourilcz/own-dashboard/issues/110):
the October staging is retired and cleaned up so nothing uses it again. Nothing is deleted.
Issue [#113](https://github.com/lukaskourilcz/own-dashboard/issues/113) carries out that decision. The plan that
replaces the staging is [`docs/reports/dneskai-instagram-2026-10-20.md`](reports/dneskai-instagram-2026-10-20.md).

This document records names and states only. It never holds a value. Do not copy any staging value into
Production. Production gets its own credentials when the issue that needs them lands, for example
[#121](https://github.com/lukaskourilcz/own-dashboard/issues/121) for the `@dneskai` Meta account and
[#122](https://github.com/lukaskourilcz/own-dashboard/issues/122) for LangSmith.

## What the code does now

- Outside Vercel Preview (`VERCEL_ENV` other than `preview`, including unset) every pilot tuple is ignored:
  `MARKETING_PILOT_*`, `MARKETING_PILOT_TEMPLATE_APPROVALS`, `MARKETING_DNESKAI_COLLECTION_PILOT_*`,
  `MARKETING_*_SOURCE_PREVIEW_*` and `MARKETING_OFFLINE_IMPORT_ENABLED`. Ignored means two things. A tuple
  grants no pilot authority: pilot collection, offline import, render preflight and the pilot sign-in link
  stay closed. And it no longer fails ordinary work: n8n and automation authentication, template
  resolution, source refresh and collection run as if the tuple were absent.
- The first time a process meets such a tuple outside Preview it writes one structured line,
  `{"event":"pilot-retired","family":…,"vercelEnv":…,"variables":[…]}`, per family. The line names
  variables and never carries their values. The shared check is `src/lib/marketing/preview-pilot.ts`.
- Inside Preview the behaviour is unchanged, including the interlock that holds paid collection while a
  generation pilot tuple is configured.
- Migration `20261020120000_scope_retired_pilot_ledgers.sql` keeps every ledger row. A generation or
  collection pilot window now blocks ordinary admission and paid collection only while it is unexpired. An
  expired tuple still cannot be replayed or extended, and ordinary admission never adopts the retained
  pilot run. A job the generation pilot reserved never becomes ordinary work: after the window, ordinary
  claim and enqueue refuse it with `pilot job retired`, so it cannot run outside its $0.25 cap. The
  migration rewrites only the pilot conditions inside the collection functions, so the Instagram limits
  and Jev planning from [#112](https://github.com/lukaskourilcz/own-dashboard/issues/112) stay as they are.

## Where the pilot ledger lives

Read-only checks on 2026-10-20:

| Database | Generation windows | Generation reservations | Collection pilots (with run) | Paid stages with unresolved cost |
|---|---|---|---|---|
| Production project `own-dashboard` | 0 | 0 | 0 | 0 |
| Supabase branch `marketing-staging-20261013` | 1 (13 Oct 09:11 to 15 Oct 09:10 UTC) | 3 × $0.25, $0.75 in total | 1 (1) | 1 |

The ledger rows exist only in the staging branch, so production was never blocked by them. The branch was
still `ACTIVE_HEALTHY` with status `MIGRATIONS_FAILED` on 2026-10-20. Keep it until the owner has reviewed
the pilot record. Deleting it also deletes the ledger and the three reservations, and cannot be undone.

## Preview environment variables

Vercel project `own-dashboard`, target Preview, git branch `codex/marketing-automation`: 59 variables on
2026-10-20. The issue counted 55 preview and 15 production variables; the listing used here has 59 and 14.
**Recommendation for every variable below: delete it after the pilot ([#123](https://github.com/lukaskourilcz/own-dashboard/issues/123)).**

| Group | Variable names |
|---|---|
| Pilot tuples, ignored outside Preview since #113 | `MARKETING_PILOT_OWNER_ID`, `MARKETING_PILOT_STARTS_AT`, `MARKETING_PILOT_EXPIRES_AT`, `MARKETING_PILOT_TEMPLATE_APPROVALS`, `MARKETING_DNESKAI_COLLECTION_PILOT_ENABLED`, `MARKETING_DNESKAI_COLLECTION_PILOT_OWNER_ID`, `MARKETING_DNESKAI_COLLECTION_PILOT_PROJECT_ID`, `MARKETING_DNESKAI_COLLECTION_PILOT_STARTS_AT`, `MARKETING_DNESKAI_COLLECTION_PILOT_EXPIRES_AT` |
| Source preview shares, ignored outside Preview since #113 | `MARKETING_DEVSHARK_SOURCE_PREVIEW_ORIGIN`, `MARKETING_DEVSHARK_SOURCE_PREVIEW_SHARE_TOKEN`, `MARKETING_DNESKAI_SOURCE_PREVIEW_ORIGIN`, `MARKETING_DNESKAI_SOURCE_PREVIEW_SHARE_TOKEN` |
| Instagram, devShark | `MARKETING_DEVSHARK_INSTAGRAM_ACCESS_TOKEN`, `MARKETING_DEVSHARK_INSTAGRAM_API_VERSION`, `MARKETING_DEVSHARK_INSTAGRAM_API_VERSION_VERIFIED_AT`, `MARKETING_DEVSHARK_INSTAGRAM_LOGIN_MODE`, `MARKETING_DEVSHARK_INSTAGRAM_TOKEN_EXPIRES_AT`, `MARKETING_DEVSHARK_INSTAGRAM_VERIFIED_SCOPES` |
| Instagram, DNESKAi | `MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN`, `MARKETING_DNESKAI_INSTAGRAM_API_VERSION`, `MARKETING_DNESKAI_INSTAGRAM_API_VERSION_VERIFIED_AT`, `MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE`, `MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT`, `MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES` |
| Publishing switches | `MARKETING_PUBLISH_ENABLED`, `MARKETING_DEVSHARK_PUBLISH_ENABLED`, `MARKETING_DNESKAI_PUBLISH_ENABLED` |
| Model and tracing | `ANTHROPIC_API_KEY`, `MARKETING_CLAUDE_MODEL`, `MARKETING_CLAUDE_INPUT_USD_PER_MTOK`, `MARKETING_CLAUDE_OUTPUT_USD_PER_MTOK`, `MARKETING_LANGSMITH_ENABLED`, `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, `LANGSMITH_PROJECT`, `LANGSMITH_TRACING`, `LANGCHAIN_TRACING`, `LANGCHAIN_TRACING_V2`, `LANGCHAIN_VERBOSE` |
| Sources, collection and providers | `MARKETING_DEVSHARK_SOURCE_URL`, `MARKETING_DEVSHARK_SOURCE_SECRET`, `MARKETING_DNESKAI_SOURCE_URL`, `MARKETING_DNESKAI_SOURCE_SECRET`, `MARKETING_DNESKAI_COLLECTION_ENABLED`, `MARKETING_DNESKAI_COLLECTION_SECRET`, `MARKETING_DNESKAI_PAID_ENABLED`, `MARKETING_DNESKAI_APIFY_ACTOR_ID`, `MARKETING_DNESKAI_APIFY_BUILD`, `APIFY_TOKEN`, `TYPESAFE_API_KEY` |
| Automation and owner controls | `MARKETING_N8N_SECRET`, `MARKETING_OWNER_ID`, `MARKETING_AI_CONSENT`, `MARKETING_APPROVED_ASSET_HOSTS`, `MARKETING_KNOWLEDGE_WORKER_ENABLED` |
| Staging database | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |

Production carries none of the pilot or preview-share names. It does carry the two variables of the
single production run below. Deleting a variable does not change preview
deployments that already exist: each keeps the values it was built with. Deployments that include the
13 October pilot guard have refused n8n and automation requests since the pilot window closed on
15 October, but their runtime still holds those values. Removing those deployments is the owner's call.

## Production variables of the single production run

Vercel project `own-dashboard`, target Production: `MARKETING_DNESKAI_MANUAL_RUN` and
`MARKETING_DNESKAI_MANUAL_SECRET`. They belong to the 13 October production verification and pair with the
n8n credential `OwnDashboard DNESKAi single production run 20261013`. `MARKETING_DNESKAI_MANUAL_RUN` is a
`dneskai-manual/1` scope for one pre-registered run, at most two hours long. The manual path that read it
(`src/lib/marketing/dneskai-manual.ts`) was deleted on 22 October 2026 with the collection pilot, so both
variables open nothing today. **Recommendation: delete both after the pilot, together with that credential.** The
other 12 production variables serve ordinary collection and stay.

Since 2026-10-22 `/api/marketing/dneskai/collect` answers `410` `{"code":"route-retired"}` before any credential
check, and `/api/marketing/n8n` gives that answer to every DNESKAi operation (audit finding cost-06). Approval no
longer calls `MARKETING_N8N_APPROVAL_WEBHOOK_URL` (cost-07). The collection, manual and approval-webhook variables
can be deleted without effect; `MARKETING_N8N_SECRET` still opens the devShark and knowledge operations.

## n8n credentials still present

| Credential name | Recommended action |
|---|---|
| `OwnDashboard DNESKAi single production run 20261013` | Rename with a `RETIRED` prefix now; delete after the pilot. |
| `OwnDashboard marketing staging — expires 2026-10-15 09:10 UTC` | Rename with a `RETIRED` prefix now; delete after the pilot. |
| `OwnDashboard DNESKAi collection pilot — expires 2026-10-15 09:10 UTC` | Rename with a `RETIRED` prefix now; delete after the pilot. |

Deleting a credential cannot be undone, so deletion stays with the owner. The retired workflow exports and
their n8n states are listed in [`workflows/marketing/retired/README.md`](../workflows/marketing/retired/README.md).
Three of them, the isolated DNESKAi pilot worker (`1hB4ROPAlWm3YSXn`), DNESKAi production verification
(`MK0xn98gIXofmZSn`) and DNESKAi rotating sources at 22:00 (`JyX8hAYI8sKMDPIc`), have no MCP access and
still need to be archived by hand. The fourth workflow, the approved UTC publication planner
(`8SOaq5tjMgnMQqEF`), was archived on 2026-10-21.

## Branch `codex/marketing-automation` (planned)

The integrator will tag the branch head as `archive/codex-marketing-automation` and then delete the branch,
so Vercel can build no new preview deployment that loads the branch-scoped variables above. The tag keeps
the history. This is planned, not done, at the time of writing.

## Owner actions

1. Archive the three n8n workflows that MCP cannot reach: `1hB4ROPAlWm3YSXn`, `MK0xn98gIXofmZSn` and
   `JyX8hAYI8sKMDPIc`. The release session archived the publication planner `8SOaq5tjMgnMQqEF` on
   2026-10-21. The pg_cron tick from [#120](https://github.com/lukaskourilcz/own-dashboard/issues/120),
   live since 2026-10-21 13:40 UTC, replaces all four.
2. Rename the three credentials above with a `RETIRED` prefix.
3. After the pilot (#123): delete the 59 preview variables, the two production variables
   `MARKETING_DNESKAI_MANUAL_RUN` and `MARKETING_DNESKAI_MANUAL_SECRET`, the three credentials and, when no
   longer needed, the old preview deployments of `codex/marketing-automation`.
4. Decide on the Supabase branch `marketing-staging-20261013` after reviewing its pilot ledger. Deleting it
   removes the record of the three $0.25 reservations ($0.75 in total) and the unresolved $0.04 collection
   stage.
