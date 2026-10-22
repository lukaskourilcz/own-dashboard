# Marketing scheduling (pg_cron tick)

Code behavior reviewed on 22 October 2026; deployment evidence remains separately dated. Originally documented for [#120](https://github.com/lukaskourilcz/own-dashboard/issues/120).
Owner decision 4 of [#110](https://github.com/lukaskourilcz/own-dashboard/issues/110): scheduling runs
in Supabase with pg_cron and pg_net. n8n keeps no marketing timer.

## How it fits together

```
pg_cron (Supabase)                      Vercel (OwnDashboard)
 marketing-tick-minute  */5 * * * *  ─┐
 marketing-tick-daily   18 2 * * *   ─┤  marketing_private.scheduler_post(kind)
                                      │   reads URL + secret from Vault, signs, net.http_post (55 s)
                                      └──────────────► POST /api/marketing/tick  (Node, maxDuration 60)
                                                        authenticateAutomation, role "scheduler"
                                                        runMarketingTick (src/lib/marketing/scheduler.ts)
                                                        record in marketing_ticks
```

- Migrations: `20261021124400_marketing_scheduler.sql` (tick record, category leases, their
  functions) and `20261021124628_marketing_scheduler_cron.sql` (extensions, the signed request,
  the two tick jobs and the run-history prune).
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

Every five minutes, 288 times a day. One tick runs at most one unit of each category, one after
another, in the order below. Each unit is wrapped, so a failure is recorded and the next category still runs.

Generation is the exception to the order (production-03). It needs 43 s of the 48 s budget, so after
media and briefs it rarely fits. When the generation precheck finds a runnable job (consent on, a queued
DNESKAi job, no live publication to yield to), the tick runs generation first and the other categories
after it in their usual order. The one exception is a collection run in progress (or due at 22:00):
then collection and generation take turns by five-minute slot. In even slots, counted from the Unix epoch
(`marketingCollectionTurn`), collection keeps its place and generation usually waits. In odd slots
generation goes first and collection usually waits. During a night with both, each gets every other
tick. Each precheck still runs once per tick: the order is chosen from its answer.

| # | Category | Runs when | One unit | Switch |
|---|---|---|---|---|
| 1 | collection | a run of the last two days is `running`, or it is 22:00 or later in Prague and today has no run | one `tickDneskaiCollection` (at most five operations, 45 s): up to three free reads concurrently, each admitted with its 25 s timeout available; paid starts and polls remain serial. Without a running run it admits today's run. `retryAfterSeconds` becomes the next allowed time; `continue: false` ends it. A date held by a retained collection-pilot run is a no-op (`collection-pilot-today`), because admission refuses it; pilot runs are never ticked here and never feed briefs. | `MARKETING_DNESKAI_COLLECTION_ENABLED`; inside the tick `MARKETING_DNESKAI_PAID_ENABLED` holds Apify and Jev, and Apify also needs `MARKETING_DNESKAI_APIFY_ENABLED` |
| 2 | media | `pendingDneskaiMediaCandidates` is not empty | one `collectDneskaiMedia` for up to eight candidates, budget at most 40 s. A `busy` candidate waits 125 s (its claim lasts 120 s), a failed pass waits 10 minutes. | `MARKETING_DNESKAI_COLLECTION_ENABLED` |
| 3 | briefs | the newest finished run of the last two days | `getCreateDneskaiBriefs(db)` (#115) for that run. Once a call reports `pending: false` the run is left alone. A call stays `pending` while a brief waits for media, for a verified account, or for a job admission that failed with a code in `DNESKAI_BRIEF_RETRYABLE_CODES`. The step has no backoff, so it calls once per five-minute tick until that brief's slot, or the target day's last slot, is under 30 minutes away. | `MARKETING_DNESKAI_COLLECTION_ENABLED` |
| 4 | generation | a queued `marketing_jobs` row of brand `dneskai` | `executeMarketingJob` for the oldest one, with `deferRetry`: a first attempt that fails copy validation puts the job back in the queue with its retry feedback, and the next tick makes the second attempt (GEN-14, see [marketing generation](marketing-generation.md)). A job that throws before it is claimed is set aside for an hour so younger jobs still run. | `MARKETING_AI_CONSENT` (and the generation module's own limits) |
| 5 | publishing | a queued DNESKAi publication inside its 15-minute window, or a claimed one waiting for its container | `publishDueMarketing(db, owner, 'dneskai', dryRun, signal)`. Live only when `MARKETING_PUBLISH_ENABLED` and `MARKETING_DNESKAI_PUBLISH_ENABLED` are both `true`; otherwise a dry run with no Meta write. | both publish switches; `marketing_accounts.enabled` is enforced by the publisher |
| 6 | reconciliation | a DNESKAi publication in `reconciliation` not checked for 30 minutes; when there is none, a `claimed` one whose lease expired (the function died mid-publish), which only `marketing_claim_due` would otherwise move to `reconciliation` | `reconcileStoredMarketingPublication`: Graph GET requests only, and the receipt when the media is found | none (read-only) |
| 7 | token | an Instagram token row for which `instagramTokenRefreshDue` is true (under ten days left, at least a day old) | `refreshInstagramToken` for one account. The refresh is marked uncertain in `marketing_scheduler_state` before the request is sent (`marketing_scheduler_save_state`); without that mark nothing is sent. `uncertain` is never retried for the same stored token, even when the answer or the release is lost; a new token from account verification lifts the block. `failed` waits a day, `held` an hour. | none: a refresh is a GET that publishes nothing, so a paused account keeps a live token |
| 8 | reminder | always, when the ports wire it (owner decision 7) | `sendDneskaiReviewReminders`: in-app notifications for the day's first post ready for review and for the first unapproved slot of today within 60 minutes, each once (keyed per day and per slot). Holds no lease and calls no provider. `DNESKAI_REVIEW_REMINDERS_ENABLED=false` records `skipped: reminders-disabled` | none |

A paused category is a recorded `skipped` with its code and costs $0. Nothing is called for it.

Collection, media, briefs and generation wait for that tick (`deferred: yield-to-publication`) while
publishing is live and either a queued DNESKAi publication is due now or within five minutes, or a
claimed carousel is waiting for its container (`container-pending`) or for a fresh container attempt
(`container-retry`). The second case matters most: the
claim lasts ten minutes and the publisher polls the container for only three seconds, so a carousel
usually needs the next tick to send `media_publish`, and a tick that spends its budget on generation
would let the claim expire into `reconciliation`. Reconciliation and token still run after publishing.

A live publish starts only with at least 30 s of the 48 s budget left; a dry run needs 15 s. A publish
cut off before its publish intent records `container-retry` and the next tick inside the claim builds
the containers again; one cut off after the intent goes to reconciliation. Starting late wastes the
claim, so a tick that is already late leaves it to the next one.

## What the daily tick does

At 02:18 UTC, between two minute ticks: the 02:15 tick has finished (the route stops at 60 s) and its
90-second leases have expired even if it died, and the 02:20 tick has not started. So the purge does not
find the media lease held by a minute tick. It runs only these duties.

| Duty | What |
|---|---|
| renewal | For the newest 50 approved or ready-for-review revisions of any brand, reads the expiry from each signed asset URL and calls `renewStoredRevisionAssetUrls` for those that expire within 48 hours or cannot be read, at most ten a day. The approval hash does not change. A revision refused with a code that cannot change (`revision-identity-mismatch`, for example one stored before #118, `revision-not-renewable`, `revision-unavailable`, `asset-input-invalid`) is set aside for seven days (`detail.setAside`); any other failure is tried again the next day, while its URLs still have a day left. |
| purge | `purgeUnusedDneskaiMedia(db, owner, 30)` under the media lease, and only when no media candidate is claimed by a collection pass. A day it is refused (`busy`, `backoff`, `media-collection-in-progress`) waits for the next daily tick; retention is 30 days, so one day later costs nothing. |
| retention | Deletes `marketing_ticks` rows older than 14 days. |

pg_cron writes one `cron.job_run_details` row per run (`cron.log_run` is on in Supabase) and never
deletes them. A third job, `marketing-cron-history-prune` (`43 3 * * *`, UTC), runs inside the
database and calls no endpoint. It deletes rows older than 14 days (by `end_time`) of the three
marketing jobs and of jobs that no longer exist, such as a tick job that was unscheduled and
scheduled again under a new `jobid`. Any other job keeps its history, including an unnamed one
(`cron.schedule(schedule, command)` stores `jobname` as null).

## Time budget

The route may run 60 s and pg_net waits 55 s. A tick starts no category after 48 s and every abort
signal fires at 53 s. Each category needs a minimum to start (collection 20 s, media 25 s,
generation 43 s, publishing 30 s when live and 15 s as a dry run, token 16 s). A category that does not fit is recorded as
`deferred: tick-budget-exhausted` with `pending: true` and runs on the next tick. A runnable generation
job goes first (see above), so media and briefs no longer push it past 43 s; during a collection run the
two alternate by slot. The Costs tab counts the ticks of the last 24 hours whose generation step was
`deferred` (`ticks.generationDeferred`, either code) and lists them among the recent ticks.

`renewStoredRevisionAssetUrls` and `purgeUnusedDneskaiMedia` take no abort signal. The tick stops waiting
for them at 53 s (`renewal-cut-off`, `purge-cut-off`), still writes its record, and does not release their
lease: it expires on its own after the function has stopped, so media collection cannot start beside a
purge that is still running.

## Idempotency and concurrency

- The tick id is the primary key of `marketing_ticks`. A replayed or retried tick finds its row and
  returns `duplicate: true` without doing anything.
- Each category takes a 90-second lease in `marketing_scheduler_state` before it works. A second tick
  running at the same moment (a retried request, a manual call) records `busy` for
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

A tick the route refuses (400, 401, 403, 413) or cannot run (503) writes no `marketing_ticks` row, and
pg_net keeps its answer for about six hours. The route therefore writes one JSON line to the Vercel
function log: `{"event":"marketing-tick-rejected","status":401,"code":"unauthorized","secretConfigured":true}`.
A 401 says whether a scheduler secret of at least 32 characters is configured; a 503 carries `cause` only
when the error message is itself a code. Search the runtime logs for `marketing-tick-rejected`. A cron run
whose `scheduler_post` found no Vault URL or secret sends nothing and reaches neither the route nor its
log; comparing `cron.job_run_details` with `marketing_ticks` (the queries above) still shows that gap.

The collection no-ops (`collection-not-due`, `collection-finished`, `collection-pilot-today`) carry
`yieldMs` and `runsMs` in `detail`: how long the publication check and the run-list read took.

The acceptance day of #120 reads as: collection `done` from 22:00 until `continue: false`, media and
briefs `done`, generation `done` once per queued job, publishing `done` with `published: 1` in the
slot, all without a single n8n execution.

## Expected volume and cost

- pg_cron: 288 minute runs, 1 daily run and 1 prune run a day, $0; `cron.job_run_details` holds
  about 14 × 290 rows. pg_net: 289 HTTP requests a day (the prune job sends none).
- Vercel: 289 function invocations a day. A tick with nothing to do makes a handful of small reads.
  A category takes its lease only after a cheap read found work for it (briefs also reads its stored
  state under the lease).
- Money is spent only where it was spent before: Apify and Jev inside collection (behind
  `MARKETING_DNESKAI_PAID_ENABLED` and the run's reservations) and Claude inside generation (behind
  `MARKETING_AI_CONSENT` and the generation module's limits). The scheduler adds no paid call.
- n8n: 0 executions for DNESKAi. The retired timers used 720 a month (collection) and about 720 a
  month (hourly publisher recovery); see `workflows/marketing/retired/README.md`.

## Release prerequisite

These are setup procedures, not authorization to run them. Production reports migration `20261021125123`, while local scheduler/media/brief filenames and ordering differ. Reconcile that history using [migration-guide.md](migration-guide.md) before applying anything. The 22 October continuation prepares additive migrations only; it deploys and applies none.

The prepared lapse-release migration changes future skips only: reports return to classified `new` status when a brief lapses without a job/revision or another active brief. The skipped brief stays as history. Never reset historic selections or reservations as a rollout shortcut.

## Turning it on

1. Set `MARKETING_SCHEDULER_SECRET` (at least 32 random characters, used nowhere else) in the
   Production environment of Vercel and deploy. `MARKETING_OWNER_ID` must already be set.
2. Apply `20261021124400_marketing_scheduler.sql`, then `20261021124628_marketing_scheduler_cron.sql`.
   The second creates pg_cron and pg_net and schedules the two tick jobs and the prune job. The
   ticks send nothing yet.
3. On the Vault page of the Supabase Dashboard (Integrations → Vault), add two secrets:
   `marketing_scheduler_url` with `https://own-dashboard-tau.vercel.app/api/marketing/tick` and
   `marketing_scheduler_secret` with the value of `MARKETING_SCHEDULER_SECRET`.

   The SQL editor works too, but only with statements that cannot fail. Postgres logs a failing
   statement with its full text (`log_min_error_statement = error`), and a plain
   `vault.create_secret` for a name that already exists fails, which would put the secret into the
   database log. A second run of these two creates nothing:

   ```sql
   select vault.create_secret('https://own-dashboard-tau.vercel.app/api/marketing/tick', 'marketing_scheduler_url')
    where not exists (select 1 from vault.secrets where name = 'marketing_scheduler_url');
   select vault.create_secret('<the value of MARKETING_SCHEDULER_SECRET>', 'marketing_scheduler_secret')
    where not exists (select 1 from vault.secrets where name = 'marketing_scheduler_secret');
   ```

   Delete the SQL editor snippet afterwards; it keeps the value in plain text.

   The function sends only to an `https` URL whose path is exactly `/api/marketing/tick`, and only
   with a secret of at least 32 characters without spaces.
4. Within five minutes `marketing_ticks` gets its first row. With every switch off it reads
   `collection-disabled`, `generation-consent-required` and no-ops.

Rotate the secret by changing it in Vercel, deploying, then editing `marketing_scheduler_secret` on the
Vault page. In SQL, update it by the id of the existing row; when there is none, nothing is called:

```sql
select vault.update_secret(id, '<new value>') from vault.secrets where name = 'marketing_scheduler_secret';
```

Delete that snippet too. Ticks between the two steps answer 401 and do nothing.

## Pausing

| To stop | Do |
|---|---|
| sources, media and briefs | `MARKETING_DNESKAI_COLLECTION_ENABLED` not `true` |
| paid sources only | `MARKETING_DNESKAI_PAID_ENABLED` not `true` (free feeds still run, but without Jev no event is selected, so no brief or generation follows) |
| Instagram (Apify) only | `MARKETING_DNESKAI_APIFY_ENABLED` not `true`: each queued Instagram stage is held with nothing reserved (`collection-apify-disabled`); free feeds and Jev still run, and the run still selects events |
| generation | `MARKETING_AI_CONSENT` not `true` |
| live publishing | either `MARKETING_PUBLISH_ENABLED` or `MARKETING_DNESKAI_PUBLISH_ENABLED` not `true` (dry runs continue) |
| one account | `marketing_accounts.enabled = false`; the publisher refuses it (`account-unverified-or-disabled`) |
| every tick, at once | `select cron.unschedule('marketing-tick-minute'); select cron.unschedule('marketing-tick-daily');` |
| every tick, from Vercel | remove `MARKETING_SCHEDULER_SECRET`; each tick answers 401 and does nothing |

DNESKAi collection, generation and publishing have no other way in (audit finding cost-06).
`/api/marketing/dneskai/collect` answers `410` with `{"code":"route-retired"}` for every method, and
`/api/marketing/n8n` gives the same answer to every DNESKAi operation, so the collection switch opens nothing outside
the tick. An approval sends no n8n
notification (cost-07); the next tick publishes the queued slot.

Unscheduling the two ticks leaves `marketing-cron-history-prune` running; it sends nothing. To stop it
too: `select cron.unschedule('marketing-cron-history-prune');`.
To start the jobs again after `cron.unschedule`, run the last `do $schedule$ … $schedule$` block of
`20261021124628_marketing_scheduler_cron.sql` again; `cron.schedule` replaces a job of the same name.

## Switches

Every `MARKETING_*` and `DNESKAI_*` environment variable the code reads, taken from `src/` on 22 October
2026 (audit finding cost-08). The defaults are what the code does when the variable is unset; this table
records no deployed value. A boolean switch is on only for the exact text `true`.

"Live" means a current production path reads it. "Off until migration" means the code is deployed but
the prepared SQL is not applied, so the switch must stay unset. "Retired" means a path from the October
pilots or n8n: Preview-only names are ignored elsewhere (`src/lib/marketing/preview-pilot.ts` logs one
`pilot-retired` line naming them), and the others wait for the cleanup after the pilot post (#123).

### Booleans and modes

| Name | Default | Gates | Status |
|---|---|---|---|
| `MARKETING_DNESKAI_COLLECTION_ENABLED` | off | Tick categories collection, media and briefs; scheduled calls to `/api/marketing/dneskai/collect` | Live |
| `MARKETING_DNESKAI_PAID_ENABLED` | off | Jev and Apify inside collection (`paidAllowed`); without it no event is selected | Live |
| `MARKETING_DNESKAI_APIFY_ENABLED` | off | Instagram (Apify) collection stages; off holds each stage with nothing reserved | Live |
| `MARKETING_AI_CONSENT` | off | Every paid model or provider call: generation, Jev, Apify, render preflight, the worker runtime, `scripts/dneskai-model-ab.ts` | Live |
| `MARKETING_PUBLISH_ENABLED` | off (dry run) | Live Meta publishing for every brand, together with the brand switch | Live |
| `MARKETING_DNESKAI_PUBLISH_ENABLED` | off (dry run) | Live DNESKAi publishing in the tick | Live |
| `MARKETING_DEVSHARK_PUBLISH_ENABLED` | off | Live devShark publishing (name built as `MARKETING_${BRAND}_PUBLISH_ENABLED`); devShark has no publishing schedule | Live code, unused |
| `MARKETING_LANGSMITH_ENABLED` | off | LangSmith traces of paid calls, the diagnostics route and owner feedback; needs the EU endpoint | Live |
| `MARKETING_KNOWLEDGE_WORKER_ENABLED` | off | Paid analysis of queued knowledge (IG TIPS) sources; off holds the queue | Live |
| `MARKETING_DNESKAI_FEED_PROVIDER` | `bridge` | `native` reads the free feeds with OwnDashboard's adapters; unset or `bridge` calls the signed Quorum bridge | Live (`bridge` is the rollback) |
| `MARKETING_PUBLICATION_REQUEUE_ENABLED` | off | "Give up and queue again" for a stranded publication (`/api/marketing/publications`) | Off until migration `20261022110000` |
| `DNESKAI_OWNER_RECOVERY_ENABLED` | off | Sources: Re-review of held reports and Move to next free slot | Off until migration `20261022141512` |
| `DNESKAI_LAPSED_RELEASE_ENABLED` | off | Sources: Release reports of a lapsed brief | Off until migrations `20261022021835` and `20261022141613` |
| `DNESKAI_SELECTION_V2_ENABLED` | off | Collection: one automatic re-review of recent Jev holds; Sources: the relevance-first explanation | Off until migrations `20261022180000` and `20261022180100` |
| `DNESKAI_REVIEW_REMINDERS_ENABLED` | on | The tick's `reminder` step; only `false` turns it off | Live |
| `DNESKAI_REGENERATE_ENABLED` | off | Lab: Regenerate with a note (`action: "regenerate"`) | Off until migration `20261022190000` |
| `DNESKAI_RICH_EVIDENCE_ENABLED` | off | Fetched article text and picture descriptions in media collection and brief/2 | Off until the evidence migrations |
| `MARKETING_DNESKAI_APIFY_RESEARCH_ENABLED` | off | The research runner (`dneskai-apify-research.ts`); it also needs `MARKETING_DNESKAI_APIFY_RESEARCH_APPROVED_PLAN` to equal the plan id | Off, waits for an approved plan |
| `MARKETING_OFFLINE_IMPORT_ENABLED` | off | Import of devShark's offline first-week assets; also needs the generation pilot window | Retired outside Preview |
| `MARKETING_DNESKAI_COLLECTION_PILOT_ENABLED` | off | The 48-hour collection pilot | Retired outside Preview |

### Values, secrets and identities

| Name | Default | Used for | Status |
|---|---|---|---|
| `MARKETING_OWNER_ID` | unset: every automation and owner-only route refuses | The single marketing owner | Live |
| `MARKETING_SCHEDULER_SECRET` | unset: `/api/marketing/tick` answers 401 | Signs the pg_cron tick | Live |
| `MARKETING_WORKER_SECRET` | unset | Automation role `worker` (`/api/marketing/jobs/[id]/execute`, `/api/marketing/automation`, the knowledge callback) | Live |
| `MARKETING_PUBLISH_SECRET` | unset | Automation role `publisher`; no route accepts that role, since the tick publishes | Retired |
| `MARKETING_DEVSHARK_SECRET` | unset | Automation role `source` for devShark (`/api/marketing/automation`) | Live |
| `MARKETING_DNESKAI_SECRET` | unset | Automation role `source` for DNESKAi | Retired |
| `MARKETING_CLAUDE_MODEL` | `claude-sonnet-5-5` | Generation and knowledge model | Live |
| `MARKETING_CLAUDE_INPUT_USD_PER_MTOK`, `MARKETING_CLAUDE_OUTPUT_USD_PER_MTOK` | 2 and 10 for the default model | Cost accounting of model calls | Live |
| `MARKETING_DNESKAI_DAILY_GENERATION_USD` | 1 | Rolling daily DNESKAi generation ceiling; a malformed value refuses every paid call | Live |
| `MARKETING_DNESKAI_APIFY_ACTOR_ID`, `MARKETING_DNESKAI_APIFY_BUILD` | unset: Apify stages refuse | The pinned Instagram actor and build | Live |
| `MARKETING_APPROVED_ASSET_HOSTS` | empty | Hosts the publisher may hand to Meta | Live |
| `MARKETING_DNESKAI_INSTAGRAM_*`, `MARKETING_DEVSHARK_INSTAGRAM_*`, `MARKETING_<BRAND>_THREADS_*` | unset | Bootstrap Meta credential: `_ACCESS_TOKEN`, `_TOKEN_EXPIRES_AT`, `_VERIFIED_SCOPES`, `_LOGIN_MODE`, `_API_VERSION`, `_API_VERSION_VERIFIED_AT` | Live for account verification and publishing |
| `MARKETING_DNESKAI_SOURCE_URL`, `MARKETING_DNESKAI_SOURCE_SECRET` | unset | Signed Quorum bridge for `bridge` feeds and DNESKAi source refresh | Rollback for the native feeds |
| `MARKETING_DEVSHARK_SOURCE_URL`, `MARKETING_DEVSHARK_SOURCE_SECRET` | unset | devShark source refresh (names built by prefix in `source-refresh.ts`) | Live |
| `MARKETING_DNESKAI_SOURCE_PREVIEW_SHARE_TOKEN`, `MARKETING_DNESKAI_SOURCE_PREVIEW_ORIGIN`, `MARKETING_DEVSHARK_SOURCE_PREVIEW_SHARE_TOKEN`, `MARKETING_DEVSHARK_SOURCE_PREVIEW_ORIGIN` | unset | Vercel Preview share for the source bridge | Retired outside Preview |
| `MARKETING_PILOT_OWNER_ID`, `MARKETING_PILOT_STARTS_AT`, `MARKETING_PILOT_EXPIRES_AT` | unset | Generation pilot window | Retired outside Preview |
| `MARKETING_PILOT_TEMPLATE_APPROVALS` | unset | Pilot template approval receipt | Retired outside Preview |
| `MARKETING_DNESKAI_COLLECTION_PILOT_OWNER_ID`, `_PROJECT_ID`, `_STARTS_AT`, `_EXPIRES_AT` | unset | Collection pilot scope | Retired outside Preview |
| `MARKETING_DNESKAI_COLLECTION_SECRET` | unset | Collection pilot and n8n-era calls to `/api/marketing/dneskai/collect` | Retired (cost-06) |
| `MARKETING_DNESKAI_MANUAL_RUN`, `MARKETING_DNESKAI_MANUAL_SECRET` | unset | One pre-registered manual collection run in Production | Retired |
| `MARKETING_N8N_SECRET` | unset | `/api/marketing/n8n`, still used for devShark and knowledge operations | Retired for DNESKAi (cost-06) |
| `MARKETING_N8N_APPROVAL_WEBHOOK_URL`, `MARKETING_N8N_WEBHOOK_SECRET` | unset: no notification | Approval notification to the archived n8n receiver | Retired (cost-07) |

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
  without Vault values or to another path, the job definitions, which run-history rows the prune
  job deletes, leases, replay and RLS.
- `tests/lib/marketing-scheduler-ports.test.ts`: the wiring to the owning modules.

A real pg_cron run, a real pg_net request and the Vault read are verified only in Supabase.
