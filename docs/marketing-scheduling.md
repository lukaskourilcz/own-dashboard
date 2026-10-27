# Marketing scheduling (pg_cron tick)

Code behavior reviewed on 23 October 2026; deployment evidence remains separately dated. Originally documented for [#120](https://github.com/lukaskourilcz/own-dashboard/issues/120).
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

## Instagram comment delivery

`POST /api/webhooks/instagram` requires the configured engagement switch and signing settings. Its unauthenticated upload is limited to 256 KiB of actual UTF-8 bytes and five seconds total, including slow chunks. Oversize, timeout and unreadable/disconnected bodies return empty 413, 408 and 400 responses respectively, before HMAC or background work. Readers are released and cancellation hooks cannot hold the response open. Valid signed deliveries retain after-response matching and the shared polling claim; this upload limit is separate from background work budgets. This is audited source behavior on 25 October, not new deployment evidence.

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
| 1a | scouting | only with `DNESKAI_SCOUTING_ENABLED` or `DNESKAI_TITLING_ENABLED` (both need `DNESKAI_TOPICS_ENABLED`): once an hour from 22:00 to 08:00 Prague (every twelfth tick) | `scoutDneskaiTopics` turns the night's education reports and library links rated 4 or 5 into proposed topics, with no model call. With `DNESKAI_FACT_OR_HYPE_ENABLED` it then buys transcripts of FACT or HYPE reels and classifies each with one Claude call. With titling it expires news topics older than 48 hours and, from 02:00, titles up to 40 untitled topics in one Claude call. Holds no lease (`dneskai-scouting.ts`, `dneskai-fact-or-hype.ts`, `dneskai-titling.ts`) | `DNESKAI_SCOUTING_ENABLED`, `DNESKAI_FACT_OR_HYPE_ENABLED`, `DNESKAI_TITLING_ENABLED` |
| 2 | media | `pendingDneskaiMediaCandidates` is not empty | one `collectDneskaiMedia` for up to eight candidates, budget at most 40 s. A `busy` candidate waits 125 s (its claim lasts 120 s), a failed pass waits 10 minutes. | `MARKETING_DNESKAI_COLLECTION_ENABLED` |
| 3 | briefs | the newest finished run of the last two days | `getCreateDneskaiBriefs(db)` (#115) for that run. Once a call reports `pending: false` the run is left alone. A call stays `pending` while a brief waits for media, for a verified account, or for a job admission that failed with a code in `DNESKAI_BRIEF_RETRYABLE_CODES`. The step has no backoff, so it calls once per five-minute tick until that brief's slot, or the target day's last slot, is under 30 minutes away. | `MARKETING_DNESKAI_COLLECTION_ENABLED` |
| 3a | enrichment | only with `DNESKAI_TOPIC_BRIEFS_ENABLED`: an approved topic waits | `advanceDneskaiTopicBriefs` (`dneskai-topic-bridge.ts`) under the briefs lease: a news topic takes its event's brief, an education topic gets a brief of its report, and a link-library or hand-added topic first has its URL read through Jina Reader and stored as an `owner-link` report. The brief is admitted to the next free slot and its generation job queued through the ordinary guards; the topic moves approved → enriching → briefed → generated | `DNESKAI_TOPIC_BRIEFS_ENABLED`, `MARKETING_DNESKAI_COLLECTION_ENABLED` |
| 4 | generation | a queued `marketing_jobs` row of brand `dneskai` | `executeMarketingJob` for the oldest one, with `deferRetry`: a first attempt that fails copy validation puts the job back in the queue with its retry feedback, and the next tick makes the second attempt (GEN-14, see [marketing generation](marketing-generation.md)). A job that throws before it is claimed is set aside for an hour so younger jobs still run. | `MARKETING_AI_CONSENT` (and the generation module's own limits) |
| 5 | publishing | a queued DNESKAi publication inside its 15-minute window, or a claimed one waiting for its container | `publishDueMarketing(db, owner, 'dneskai', dryRun, signal)`. Live only when `MARKETING_PUBLISH_ENABLED` and `MARKETING_DNESKAI_PUBLISH_ENABLED` are both `true`; otherwise a dry run with no Meta write. | both publish switches; `marketing_accounts.enabled` is enforced by the publisher |
| 6 | reconciliation | a DNESKAi publication in `reconciliation` not checked for 30 minutes; when there is none, a `claimed` one whose lease expired (the function died mid-publish), which only `marketing_claim_due` would otherwise move to `reconciliation` | `reconcileStoredMarketingPublication`: Graph GET requests only, and the receipt when the media is found | none (read-only) |
| 7 | token | an Instagram token row for which `instagramTokenRefreshDue` is true (under ten days left, at least a day old) | `refreshInstagramToken` for one account. The refresh is marked uncertain in `marketing_scheduler_state` before the request is sent (`marketing_scheduler_save_state`); without that mark nothing is sent. `uncertain` is never retried for the same stored token, even when the answer or the release is lost; a new token from account verification lifts the block. `failed` waits a day, `held` an hour. | none: a refresh is a GET that publishes nothing, so a paused account keeps a live token |
| 8 | engagement | `DNESKAI_ENGAGEMENT_ENABLED=true` and the ports wire it (#160) | `runDneskaiEngagementWatch` (`dneskai-engagement-watch.ts`, wired in `dneskai-engagement-ports.ts`) under the publishing lease: for up to 20 DNESKAi Instagram posts published in the last seven days whose revision carries a keyword, on an account whose reply switch is on and not blocked, least recently checked first, it reads `GET /<media-id>/comments` (50 a page, at most 200 comments a tick, an unfinished pass continues from its cursor) and matches the keyword (lower case, no diacritics or punctuation, a whole word in a comment of at most five words). A match is claimed in `marketing_instagram_comment_replies` (unique comment id) before `POST /<IG_ID>/messages` with `recipient.comment_id` sends the approved DM, then `POST /<comment-id>/replies` posts the public reply when set. A lost answer stays `uncertain` and is never retried. Comments older than seven days are counted, not answered. Graph code 10 (messaging off for connected tools) blocks the account; a dead token or a rate limit stops the tick's pass. Records counts only | `DNESKAI_ENGAGEMENT_ENABLED` |
| 9 | reminder | always, when the ports wire it (owner decision 7) | `sendDneskaiReviewReminders`: in-app notifications for the day's first post ready for review and for the first unapproved slot of today within 60 minutes, each once (keyed per day and per slot). Holds no lease and calls no provider. `DNESKAI_REVIEW_REMINDERS_ENABLED=false` records `skipped: reminders-disabled` | none |

A paused category is a recorded `skipped` with its code and costs $0. Nothing is called for it.

### Reels (#165)

With `MARKETING_DNESKAI_REELS_ENABLED=true`, a DNESKAi post whose format is `reel` (a carousel deck the owner
switched to Reel in the Lab, or an education post generated as one) publishes as the rendered slideshow:

- **Render ahead.** A queued Reel within 45 minutes of its slot counts as publishing work. The step asks this
  deployment's `/api/marketing/dneskai/render-reel` (signed as the scheduler, `async: true`) for its MP4 and does not
  wait: the route answers 202 and renders in `after()` within its own 300 s. A post without its own track gets the
  next enabled library track after the previous Reel's. Each stored Reel is recorded as a `dneskai-reel-rendered`
  row in `marketing_events`, which is how the publisher and the rotation find it.
- **No claim without the video.** At its slot a Reel whose MP4 is not stored yet stays queued with
  `reel-render-pending` and the render is asked for again; the next tick inside the 15-minute window publishes it.
  Switched off, a Reel stays queued as `reels-disabled`. Neither claims, so neither turns into a failure.
- **Publishing.** The publisher downloads the MP4 and checks its size and sha256, then creates one container:
  `media_type=REELS`, `video_url`, `cover_url` = slide 1, `share_to_feed=true`, the caption. A video container is
  polled up to six times three seconds apart; still `IN_PROGRESS`, it stays `container-pending` for the next tick,
  inside the same claim and window. Then one `media_publish`, as for every post.
- **Quota.** The publisher refuses at 50 posts in 24 hours (`content_publishing_limit`), even if the account reports
  a higher total.
- **Reconciliation** matches a Reel listed as `VIDEO` or `REELS`.

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
| audio-trends | Only with `DNESKAI_AUDIO_TRENDS_ENABLED` and Facebook Login: reads Meta's trending sounds (`GET /ig_audio`) and stores the day's list in `marketing_audio_trends`, at most 25 per type. With `DNESKAI_TIKTOK_TRENDS_ENABLED` it also reads yesterday's TikTok CZ sound chart run, marks the matching rows `tiktok`, then reserves and starts today's run (`dneskai-audio-trends.ts`, `dneskai-audio-tiktok.ts`). |

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
- Money is spent in four places: Apify and Jev inside collection (behind `MARKETING_DNESKAI_PAID_ENABLED` and the
  run's reservations), Claude inside generation (behind `MARKETING_AI_CONSENT` and the $1 daily ceiling), the
  scouting step's transcripts and Claude Haiku calls (behind `DNESKAI_FACT_OR_HYPE_ENABLED` or
  `DNESKAI_TITLING_ENABLED`, reserved in the topic spend ledger: transcripts under their own $0.50 a day, model calls
  inside the $1), and the daily TikTok chart run (behind `DNESKAI_TIKTOK_TRENDS_ENABLED`, its own $0.10 a day). With
  those three switches off the scheduler adds no paid call.
- n8n: 0 executions for DNESKAi. The retired timers used 720 a month (collection) and about 720 a
  month (hourly publisher recovery); see `workflows/marketing/retired/README.md`.

## Release prerequisite

These are setup procedures, not authorization to run them. The 23-file rollout through `20261023130300` completed on 23 October. Thirty-two audit migrations (87–118), ending with `20261025040638_complete_dneskai_cost_reads.sql`, remain prepared/unapplied; apply their complete ordered chain before deploying this audit branch, as [migration-guide.md](migration-guide.md#applying-the-prepared-migrations) describes.

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

Every `MARKETING_*` and `DNESKAI_*` environment variable the code reads, taken from `src/` on 23 October
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
| `DNESKAI_OWNER_RECOVERY_ENABLED` | off | Topic recovery (⋯ menu): Re-review of held reports and Move to next free slot | Off until migration `20261022141512` |
| `DNESKAI_LAPSED_RELEASE_ENABLED` | off | Topic recovery (⋯ menu): Release reports of a lapsed brief | Off until migrations `20261022021835` and `20261022141613` |
| `DNESKAI_SELECTION_V2_ENABLED` | off | Collection: one automatic re-review of recent Jev holds; Topic recovery (⋯ menu): the relevance-first explanation | Off until migrations `20261022180000` and `20261022180100` |
| `DNESKAI_ENGAGEMENT_ENABLED` | off | The tick's `engagement` step, the account's reply switch (`/api/marketing/accounts/engagement`) and the accounts read of its columns | Off until migration `20261023120000` |
| `DNESKAI_REVIEW_REMINDERS_ENABLED` | on | The tick's `reminder` step; only `false` turns it off | Live |
| `DNESKAI_REGENERATE_ENABLED` | off | Lab: Regenerate with a note (`action: "regenerate"`) | Off until migration `20261022190000` |
| `DNESKAI_TOPICS_ENABLED` | off | Topics (náměty): `GET` and `POST /api/marketing/dneskai/topics` and their read model; off answers 404 | Off until migration `20261023100000` |
| `DNESKAI_SCOUTING_ENABLED` | off | Collection also reads the education sources (never sent to Jev); the tick's `scouting` step turns them and library links rated 4 or 5 into proposed topics, hourly 22:00–08:00 | Needs `DNESKAI_TOPICS_ENABLED` and migration `20261023100000` |
| `DNESKAI_FACT_OR_HYPE_ENABLED` | off | Scouting step: transcripts of FACT or HYPE reels (Apify, $0.05 each, own ceiling `MARKETING_DNESKAI_TRANSCRIPT_DAILY_USD`, default $0.50) and one Claude call each for tool and verdict | Needs scouting, migration `20261023100100`, `MARKETING_DNESKAI_APIFY_ENABLED`, `MARKETING_DNESKAI_PAID_ENABLED`, `MARKETING_AI_CONSENT` and `APIFY_TOKEN` |
| `DNESKAI_TITLING_ENABLED` | off | Briefs step: a finished run's selected events become news topics instead of briefs. Scouting step: news topics expire after 48 hours; from 02:00 one Claude call titles up to 40 untitled topics | Needs `DNESKAI_TOPICS_ENABLED` and migrations `20261023100000`, `20261023100100`, `MARKETING_AI_CONSENT`; set it with `DNESKAI_TOPIC_BRIEFS_ENABLED`, since titling stops the automatic briefs |
| `DNESKAI_TOPIC_BRIEFS_ENABLED` | off | Tick step `enrichment` after briefs: approved topics become briefs and queued generation jobs through the ordinary guards | Needs `DNESKAI_TOPICS_ENABLED` and migrations `20261023100000`, `20261023100200` |
| `DNESKAI_DAILY_MIX_ENABLED` | off | Zdroje → Denní mix; the briefs step proposes three news topics per wanted news post; the topic bridge fills each day with the wanted number of topics per kind and only the active times | Needs `DNESKAI_TOPICS_ENABLED`, migration `20261023100300` and prepared captured-save migration `20261024170208` before deploying the updated caller |
| `DNESKAI_SOURCES_TABLE_ENABLED` | off | Zdroje edits `marketing_dneskai_sources`; enabled settings are read completely, and an empty list stays empty. Failed reads stop admission. Visits never seed rows. Off, collection/scouting read the registry and Zdroje is read-only | Needs migration `20261023110000` and prepared captured-write migration `20261024174247` before deploying the updated caller |
| `DNESKAI_TIKTOK_TRENDS_ENABLED` | off | Inside the daily `audio-trends` step: one TikTok CZ sound chart run a day (Apify, $0.10 cap, `MARKETING_DNESKAI_TIKTOK_DAILY_USD`), read the next day | Off until migration `20261023130300`; needs `DNESKAI_AUDIO_TRENDS_ENABLED`, Facebook Login, `MARKETING_DNESKAI_APIFY_ENABLED`, `MARKETING_DNESKAI_PAID_ENABLED`, `MARKETING_AI_CONSENT` and the owner's spend approval |
| `DNESKAI_AUDIO_TRENDS_ENABLED` | off | Daily `audio-trends` step (Meta's trending sounds, Facebook Login only), "Trendy zvuky" in Zdroje → Hudba and the picker, `audio_configuration` on a Reel | Off until migration `20261023130200` and Facebook Login (#166) |
| `MARKETING_DNESKAI_REELS_ENABLED` | off | Reels: the render route (#163), Zdroje → Hudba and the Lab's music picker (#164), the Formát switch, Reel generation for education posts and Reel publishing (#165) | Off until migrations `20261023130000` and `20261023130100` |
| `DNESKAI_ENGAGEMENT_EDITOR_ENABLED` | off | Lab: the comment keyword, DM message and public reply editor; `engagement` in `action: "edit"` | Off, needs no migration |
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
| `MARKETING_DNESKAI_TRANSCRIPT_DAILY_USD` | 0.50 | Daily ceiling of FACT or HYPE reel transcripts; a malformed value refuses every transcript | Off until migration `20261023100100` |
| `MARKETING_DNESKAI_TIKTOK_DAILY_USD` | 0.10 | Daily ceiling of the TikTok CZ chart run (at most 1); a malformed value refuses every run | Off until migration `20261023130300` |
| `MARKETING_DNESKAI_REEL_ACTOR_ID`, `MARKETING_DNESKAI_REEL_BUILD` | `apify~instagram-reel-scraper` (`xMc5Ga1oCONPmWJIa`), build `0.0.617` | The reel transcript actor of FACT or HYPE | Off until migration `20261023100100` |
| `MARKETING_DNESKAI_TOPIC_MODEL` | `claude-haiku-5-5` | The model of FACT or HYPE and titling | Off until migration `20261023100100` |
| `MARKETING_DNESKAI_TOPIC_INPUT_USD_PER_MTOK`, `MARKETING_DNESKAI_TOPIC_OUTPUT_USD_PER_MTOK` | 0.1 and 0.5 for the default model; another model needs both | Cost accounting of topic model calls | Off until migration `20261023100100` |
| `MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE` | `instagram` | `facebook` switches verification, publishing, the comment watcher and the webhook signature to Facebook Login for Business (#166, #216) | Live (`instagram`) |
| `MARKETING_META_APP_ID`, `MARKETING_META_APP_SECRET` | unset | Facebook Login: token renewal through `fb_exchange_token`, and the webhook signature under Facebook Login | Waits for Facebook Login |
| `MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `MARKETING_INSTAGRAM_APP_SECRET` | unset: `/api/webhooks/instagram` answers 404 | The comment webhook's verify token (at least 16 characters; 32 recommended) and the Instagram app secret that signs its deliveries under Instagram Login | Waits for `DNESKAI_ENGAGEMENT_ENABLED` |
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

Read-only reconciliation requires the complete normalized submitted caption, matching account/media kind and time, and no advertised continuation of the media page. A shared caption prefix or a short page with `paging.next` stays unresolved; recovery never retries publication.


### Music read recovery — audit branch, 27 October 2026

The first library page reports `trendsStatus` as `ready`, `unavailable` or `disabled`. A ready response includes its complete validated bounded recommendations; a confirmed empty list has its own quiet display. Optional project/niche/trend work shares a separate six-second lifetime inside the existing eighteen-second GET budget and uses a transport that ends with that lifetime. Failure retains confirmed uploaded tracks and returns unavailable, while actual caller cancellation remains terminal. Later/selected-track pages perform no optional trend work. Owner, Prague observation day and source-mode flags are captured before the library wait.

Music and the post picker show the same explicit retry, retain the saved sound value and do not offer unconfirmed recommendations. The desktop message/action row fits its contents; mobile uses one full-width action. The manual post hint shares the existing paged-library cache, reads only while due, memoizes its derived choice and keeps copy feedback bound to the clicked name/latest attempt. The existing seven-day hint policy, ten-second preview startup/disposal, approval hashes and publication authority remain unchanged. All changes here are locally verified code, not a live account or automatic-publication receipt.


### Account-bound Meta observations (prepared audit callers)

Finding 314 and migration 136 replace the daily prior-read/upsert with one atomic account-bound observation batch. The pass captures the owner, verified account tuple, Prague day, clock and configuration before provider waits; both complete bounded Graph responses and persistence share a fifteen-second lifetime. A stale account/day/input result stops before optional paid TikTok work. Paused publishing does not prevent free metadata reads.

The recent fifty-sound recommendation projection requires current account/remote-id/full verification-time proof. Legacy history remains stored but does not establish present attachment availability. Current complete niche counts replace the old stored fallback; undated legacy TikTok flags do not establish a current cross-platform signal. Dated TikTok persistence remains under review. Apply all fifty-one prepared audit migrations (87–137) before deploying these callers. No switch or paid allowance is enabled by this code change.


The prepared TikTok matcher (finding 315) compares exact normalized title and known artist within one bounded returned set. It refuses multiple/conflicting recordings and continued results, and deduplicates equivalent chart entries before searching. A failed search keeps the existing run unresolved; it cannot confirm an empty match or start another paid run. The unchanged twelve-second pass now bounds complete JSON at 256 KiB of actual UTF-8 bytes. This establishes neither global-catalog uniqueness nor a licence. Finding 316 adds dated signal persistence and atomic completion; new paid admission/bind receipts and worst-case matching progress remain under review.


Finding 316 replaces direct TikTok Boolean updates and separate settlement with one account/reservation-bound completion transaction. The chart keeps its reservation’s Prague source day; reading an old run cannot refresh its signal. Current account search proof can supplement the recent Meta list without changing confirmed Meta titles, duration, artwork or history. Legacy flags and settlements stay unproven. The progress read is complete within an explicit elapsed 72-hour/1,000-record/2 MiB bound. Unknown metering keeps the run/reservation unresolved and starts no later paid work in that pass; known costs round up to the ledger’s precision. Terminal results younger than ten seconds wait for a later tick, following [Apify’s guidance](https://docs.apify.com/api/v2/actor-run-get). No provider request or paid start runs during verification. All 51 audit migrations (87–137) remain prepared.
