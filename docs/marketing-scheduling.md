# Marketing scheduling (pg_cron tick)

Current state as of 20 October 2026, [#120](https://github.com/lukaskourilcz/own-dashboard/issues/120).
Owner decision 4 of [#110](https://github.com/lukaskourilcz/own-dashboard/issues/110): scheduling runs
in Supabase with pg_cron and pg_net. n8n keeps no marketing timer.

## How it fits together

```
pg_cron (Supabase)                      Vercel (OwnDashboard)
 marketing-tick-minute  */5 * * * *  ─┐
 marketing-tick-daily   15 2 * * *   ─┤  marketing_private.scheduler_post(kind)
                                      │   reads URL + secret from Vault, signs, net.http_post (55 s)
                                      └──────────────► POST /api/marketing/tick  (Node, maxDuration 60)
                                                        authenticateAutomation, role "scheduler"
                                                        runMarketingTick (src/lib/marketing/scheduler.ts)
                                                        record in marketing_ticks
```

- Migrations: `20261020160000_marketing_scheduler.sql` (tick record, category leases, their
  functions) and `20261020160100_marketing_scheduler_cron.sql` (extensions, the signed request,
  the two jobs).
- Route: `src/app/api/marketing/tick/route.ts`. Body `{"tick": "<uuid>", "kind": "minute" | "daily"}`.
- The request carries the same signature as every other automation call: `Authorization: Bearer
  <secret>`, `X-Marketing-Timestamp` (Unix seconds, accepted within ±300 s) and
  `X-Marketing-Signature` = hex HMAC-SHA256(secret, `timestamp + "." + body`). The body is the exact
  text pg_net sends. Only the role `scheduler` (`MARKETING_SCHEDULER_SECRET`, at least 32 characters
  and different from every other marketing secret) may call the route, and that role opens no other
  route.
- `src/lib/marketing/scheduler-ports.ts` connects the tick to the modules that own the work. The
  scheduler adds no logic of its own to collection, media, briefs, generation, publishing or tokens.

## What a minute tick does

Every five minutes, 288 times a day. One tick runs at most one unit of each category, in this order,
one after another. Each unit is wrapped, so a failure is recorded and the next category still runs.

| # | Category | Runs when | One unit | Switch |
|---|---|---|---|---|
| 1 | collection | a run of the last two days is `running`, or it is 22:00 or later in Prague and today has no run | one `tickDneskaiCollection` (at most five operations, 45 s). Without a running run it admits today's run. `retryAfterSeconds` becomes the next allowed time; `continue: false` ends it. A date held by a retained collection-pilot run is a no-op (`collection-pilot-today`), because admission refuses it; pilot runs are never ticked here and never feed briefs. | `MARKETING_DNESKAI_COLLECTION_ENABLED`; `MARKETING_DNESKAI_PAID_ENABLED` inside the tick holds Apify and Jev |
| 2 | media | `pendingDneskaiMediaCandidates` is not empty | one `collectDneskaiMedia` for up to eight candidates, budget at most 40 s. A `busy` candidate waits 125 s (its claim lasts 120 s), a failed pass waits 10 minutes. | `MARKETING_DNESKAI_COLLECTION_ENABLED` |
| 3 | briefs | the newest finished run of the last two days | `getCreateDneskaiBriefs(db)` for that run. Once a call reports `pending: false` the run is left alone. Until #115 wires it, `briefs-unwired` is a recorded skip. | `MARKETING_DNESKAI_COLLECTION_ENABLED` |
| 4 | generation | a queued `marketing_jobs` row of brand `dneskai` | `executeMarketingJob` for the oldest one. A job that throws before it is claimed is set aside for an hour so younger jobs still run. | `MARKETING_AI_CONSENT` (and the generation module's own limits) |
| 5 | publishing | a queued DNESKAi publication inside its 15-minute window, or a claimed one waiting for its container | `publishDueMarketing(db, owner, 'dneskai', dryRun, signal)`. Live only when `MARKETING_PUBLISH_ENABLED` and `MARKETING_DNESKAI_PUBLISH_ENABLED` are both `true`; otherwise a dry run with no Meta write. | both publish switches; `marketing_accounts.enabled` is enforced by the publisher |
| 6 | reconciliation | a DNESKAi publication in `reconciliation` not checked for 30 minutes; when there is none, a `claimed` one whose lease expired (the function died mid-publish), which only `marketing_claim_due` would otherwise move to `reconciliation` | `reconcileStoredMarketingPublication`: Graph GET requests only, and the receipt when the media is found | none (read-only) |
| 7 | token | an Instagram token row for which `instagramTokenRefreshDue` is true (under ten days left, at least a day old) | `refreshInstagramToken` for one account. `uncertain` is never retried for the same stored token; a new token from account verification lifts the block. `failed` waits a day, `held` an hour. | none: a refresh is a GET that publishes nothing, so a paused account keeps a live token |

A paused category is a recorded `skipped` with its code and costs $0. Nothing is called for it.

Collection, media, briefs and generation wait for that tick (`deferred: yield-to-publication`) while
publishing is live and either a queued DNESKAi publication is due now or within five minutes, or a
claimed carousel is waiting for its container (`container-pending`). The second case matters most: the
claim lasts ten minutes and the publisher polls the container for only three seconds, so a carousel
usually needs the next tick to send `media_publish`, and a tick that spends its budget on generation
would let the claim expire into `reconciliation`. Reconciliation and token still run after publishing.

A live publish starts only with at least 30 s of the 48 s budget left; a dry run needs 15 s. A publish
cut off between its container-create intent and the container cannot be retried, so a tick that is
already late leaves it to the next one.

## What the daily tick does

At 02:15 UTC. It runs only these duties; the minute tick that fires at the same moment does the rest.

| Duty | What |
|---|---|
| renewal | For the newest 50 approved or ready-for-review revisions of any brand, reads the expiry from each signed asset URL and calls `renewStoredRevisionAssetUrls` for those that expire within 48 hours or cannot be read, at most ten a day. The approval hash does not change. |
| purge | `purgeUnusedDneskaiMedia(db, owner, 30)` under the media lease, and only when no media candidate is claimed by a collection pass. |
| retention | Deletes `marketing_ticks` rows older than 14 days. |

## Time budget

The route may run 60 s and pg_net waits 55 s. A tick starts no category after 48 s and every abort
signal fires at 53 s. Each category needs a minimum to start (collection 20 s, media 25 s,
generation 43 s, publishing 15 s, token 16 s). A category that does not fit is recorded as
`deferred: tick-budget-exhausted` with `pending: true` and runs on the next tick. In practice a
collection step at night uses most of a tick, so media and generation follow once collection is done.

## Idempotency and concurrency

- The tick id is the primary key of `marketing_ticks`. A replayed or retried tick finds its row and
  returns `duplicate: true` without doing anything.
- Each category takes a 90-second lease in `marketing_scheduler_state` before it works. A second tick
  running at the same moment (the minute and daily jobs at 02:15, a manual call) records `busy` for
  what the first one holds. A lease of a tick that died expires before the next tick.
- The leases sit on top of the existing fences: the collection run lease, the media candidate claim,
  the job lease, the publication claim and the token compare-and-set. Media retention uses the media
  lease, so it never runs while media are collected.

## Measuring

Every accepted tick leaves one row: `started_at`, `finished_at`, `kind`, `did` (one entry per category:
`status` is `done`, `noop`, `skipped`, `busy`, `backoff`, `deferred` or `error`, with `code`, `ms`,
`pending` and a small `detail` of counts and ids) and `errors`. The owner can read the table; it holds
no tokens, source text or URLs.

```sql
-- Ticks and their duration over the last day
select kind, count(*) as ticks, round(avg(extract(epoch from finished_at - started_at))::numeric, 2) as avg_s,
       max(extract(epoch from finished_at - started_at)) as max_s
from marketing_ticks where started_at > now() - interval '1 day' group by kind;

-- Everything that was not a no-op
select started_at, step->>'category' as category, step->>'status' as status, step->>'code' as code, step->'detail' as detail
from marketing_ticks, jsonb_array_elements(did) as step
where started_at > now() - interval '1 day' and step->>'status' <> 'noop' order by started_at;

-- Errors, and ticks that never finished (stopped at the function limit)
select started_at, errors from marketing_ticks where jsonb_array_length(errors) > 0 order by started_at desc limit 20;
select id, started_at from marketing_ticks where finished_at is null and started_at < now() - interval '2 minutes';

-- Delivery from the database side
select id, status_code, timed_out, error_msg, created from net._http_response order by created desc limit 20;
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname like 'marketing-tick-%' order by d.start_time desc limit 20;
```

The acceptance day of #120 reads as: collection `done` from 22:00 until `continue: false`, media and
briefs `done`, generation `done` once per queued job, publishing `done` with `published: 1` in the
slot, all without a single n8n execution.

## Expected volume and cost

- pg_cron: 288 minute runs and 1 daily run a day, $0. pg_net: the same 289 HTTP requests.
- Vercel: 289 function invocations a day. A tick with nothing to do makes a handful of small reads.
  A category takes its lease only after a cheap read found work for it (briefs also reads its stored
  state under the lease).
- Money is spent only where it was spent before: Apify and Jev inside collection (behind
  `MARKETING_DNESKAI_PAID_ENABLED` and the run's reservations) and Claude inside generation (behind
  `MARKETING_AI_CONSENT` and the generation module's limits). The scheduler adds no paid call.
- n8n: 0 executions for DNESKAi. The retired timers used 720 a month (collection) and about 720 a
  month (hourly publisher recovery); see `workflows/marketing/retired/README.md`.

## Turning it on

1. Set `MARKETING_SCHEDULER_SECRET` (at least 32 random characters, used nowhere else) in the
   Production environment of Vercel and deploy. `MARKETING_OWNER_ID` must already be set.
2. Apply `20261020160000_marketing_scheduler.sql`, then `20261020160100_marketing_scheduler_cron.sql`.
   The second creates pg_cron and pg_net and schedules both jobs. They send nothing yet.
3. In the Supabase SQL editor:

   ```sql
   select vault.create_secret('https://own-dashboard-tau.vercel.app/api/marketing/tick', 'marketing_scheduler_url');
   select vault.create_secret('<the value of MARKETING_SCHEDULER_SECRET>', 'marketing_scheduler_secret');
   ```

   The function sends only to an `https` URL whose path is exactly `/api/marketing/tick`, and only
   with a secret of at least 32 characters without spaces.
4. Within five minutes `marketing_ticks` gets its first row. With every switch off it reads
   `collection-disabled`, `generation-consent-required` and no-ops.

Rotate the secret by changing it in Vercel, deploying, then
`select vault.update_secret((select id from vault.secrets where name = 'marketing_scheduler_secret'), '<new value>');`.
Ticks between the two steps answer 401 and do nothing.

## Pausing

| To stop | Do |
|---|---|
| sources, media and briefs | `MARKETING_DNESKAI_COLLECTION_ENABLED` not `true` |
| paid sources only | `MARKETING_DNESKAI_PAID_ENABLED` not `true` (free feeds still run) |
| generation | `MARKETING_AI_CONSENT` not `true` |
| live publishing | either `MARKETING_PUBLISH_ENABLED` or `MARKETING_DNESKAI_PUBLISH_ENABLED` not `true` (dry runs continue) |
| one account | `marketing_accounts.enabled = false`; the publisher refuses it (`account-unverified-or-disabled`) |
| every tick, at once | `select cron.unschedule('marketing-tick-minute'); select cron.unschedule('marketing-tick-daily');` |
| every tick, from Vercel | remove `MARKETING_SCHEDULER_SECRET`; each tick answers 401 and does nothing |

To start the jobs again after `cron.unschedule`, run the last `do $schedule$ … $schedule$` block of
`20261020160100_marketing_scheduler_cron.sql` again; `cron.schedule` replaces a job of the same name.

## Testing

- `tests/lib/marketing-scheduler.test.ts`: no-op tick, one unit per category in order, the time
  budget, isolated failures, pauses, the publication yield, collection admission and backoff, media
  backoff, briefs (`briefs-unwired` and done runs), job set-aside, token refresh rules, two concurrent
  ticks, the daily duties.
- `tests/lib/marketing-tick-route.test.ts`: signature, timestamp skew, wrong role, input and error
  answers of the route.
- `tests/lib/marketing-scheduler-database.test.ts`: both migrations in PGlite with pgcrypto and
  stand-ins for Vault, pg_net and pg_cron. It checks that the request is signed over the exact bytes
  pg_net sends and that `authenticateAutomation` accepts it as `scheduler`, that nothing is sent
  without Vault values or to another path, the job definitions, leases, replay and RLS.
- `tests/lib/marketing-scheduler-ports.test.ts`: the wiring to the owning modules.

A real pg_cron run, a real pg_net request and the Vault read are verified only in Supabase.
