# Retired n8n exports

Retired on **2026-10-20** under [#113](https://github.com/lukaskourilcz/own-dashboard/issues/113),
owner decision 9 of the DNESKAi Instagram epic [#110](https://github.com/lukaskourilcz/own-dashboard/issues/110):
the October staging is retired and cleaned up so nothing uses it again, and nothing is deleted.
The two remaining DNESKAi timers followed the same day under
[#120](https://github.com/lukaskourilcz/own-dashboard/issues/120) (owner decision 4: scheduling runs
in Supabase pg_cron, not n8n).
The plan that replaces these files is in
[`docs/reports/dneskai-instagram-2026-10-20.md`](../../../docs/reports/dneskai-instagram-2026-10-20.md).
The staging inventory (preview variable names, n8n credentials, branch) is in
[`docs/marketing-staging-retired-2026-10.md`](../../../docs/marketing-staging-retired-2026-10.md).

Every file here is a byte-for-byte move from `workflows/marketing/`. All of them are `active: false`
and carry placeholder credential IDs only. Do not import or publish them again. To restore one,
move it back with `git mv` and review it against the current API first; an archived n8n workflow
can be unarchived in n8n Cloud.

| File | n8n workflow (id) | What it was | Why it is retired | n8n state on 2026-10-21 |
|---|---|---|---|---|
| `dneskai-collection-pilot-worker.json`, `dneskai-collection-pilot-worker.md` | isolated DNESKAi pilot worker (`1hB4ROPAlWm3YSXn`) | Manual start plus detached internal continuations. Each execution sent one `pilot: true` tick to `/api/marketing/dneskai/collect` on a Vercel Preview origin, using the `MARKETING_DNESKAI_COLLECTION_PILOT_*` window and the one-run collection pilot ledger. | The pilot window ended on 2026-10-15 09:10 UTC. The ledger allows one run per owner for life, so the worker can never admit another one. Preview staging is retired. | Not archived: the workflow has no MCP access. The owner archives it by hand. |
| `dneskai-production-verification.json` | DNESKAi production verification (`MK0xn98gIXofmZSn`) | Manual start plus internal continuations for one run registered in advance. Ticks were sent with `manual: true` under the `MARKETING_DNESKAI_MANUAL_RUN` scope, a window of at most two hours. | A one-off check for the run registered on 13 October. Its two-hour scope has expired, and the pg_cron ticker ([#120](https://github.com/lukaskourilcz/own-dashboard/issues/120)) replaces n8n orchestration. | Not archived: the workflow has no MCP access. The owner archives it by hand. |
| `staging-source-check.json`, `staging-source-check.md` | marketing staging source check (`pGCnlrtARffkMdw7`) | One manual POST that refreshed three devShark source heads on a single Preview deployment, sent with the staging n8n secret and a Vercel protection cookie. | It was run once, on 13 October. The deployment access expired on 15 October. | Archived. |
| `daily-preparation.json` | DNESKAi daily preparation (`nyFAwH7lBpqK3tTR`) | A 07:00 Prague schedule: discover article sources and calendar entries, enqueue up to eight generation jobs, execute them and read their status. | It depends on DNESKAi articles, which are paused (decision 1). Socials no longer wait for an article, and scheduling moves to pg_cron (#120). | Archived. |
| `source-reconciliation.json` | source reconciliation (`lB4tFoj9y0sTY08f`) | Manual discovery and refresh of up to 20 article-source identities through `/api/marketing/n8n`. | It belongs to the same article-source path as daily preparation. | Archived. |
| `dneskai-source-collection.json` | DNESKAi rotating sources at 22:00 (`JyX8hAYI8sKMDPIc`) | A `*/5 22-23` Prague schedule plus a manual start. Each execution sent one step of the day's collection run to `/api/marketing/dneskai/collect` with `MARKETING_DNESKAI_COLLECTION_SECRET`. | Retired under [#120](https://github.com/lukaskourilcz/own-dashboard/issues/120) on 2026-10-20. The pg_cron tick (`POST /api/marketing/tick`) admits and continues the same run at no n8n cost; 24 executions a night became 0. | Inactive, not archived: n8n MCP access is off for this workflow. The owner archives it by hand. |
| `approved-publisher.json` | approved UTC publication planner (`8SOaq5tjMgnMQqEF`) | An approval webhook and an hourly recovery schedule that read the approved publication plan, waited until each exact UTC slot, called the publisher with `dryRun:true` and reconciled ambiguous outcomes read-only. | Retired under #120 on 2026-10-20. The tick publishes due slots every five minutes and reconciles one publication per tick; 24 hourly executions a day became 0. | Archived on 2026-10-21 by the release session of #120. |

The Cloud workspace also held **daily marketing preparation** (`R3Za5yJAZOd8gFFK`), archived the same
day. It has no export of its own in this repository.

## Replaced by the pg_cron tick (#120)

The last two n8n timers moved here on 2026-10-20. Scheduling now runs inside Supabase: pg_cron calls
`marketing_private.scheduler_post` every five minutes and once a day, and pg_net sends one signed
request to `POST /api/marketing/tick`. What a tick does, how to measure it in `marketing_ticks` and
how to pause it is in [`docs/marketing-scheduling.md`](../../../docs/marketing-scheduling.md).
n8n Cloud keeps no marketing timer. A notification workflow (for example after an approval) would
be new work and is created only when the owner asks for it.

The other exports still in `workflows/marketing/` (`devshark-weekly-preparation.json`,
`knowledge-processing.json`, `weekly-review.json`) belong to devShark and the knowledge import, not
to the DNESKAi chain, and stay where they are.

## Credentials

Three n8n credentials from the staging window still exist. Their values never appear in the
repository.

- `OwnDashboard DNESKAi single production run 20261013`
- `OwnDashboard marketing staging — expires 2026-10-15 09:10 UTC`
- `OwnDashboard DNESKAi collection pilot — expires 2026-10-15 09:10 UTC`

Rename each with a `RETIRED` prefix. Deleting a credential cannot be undone, so that choice stays with
the owner.
