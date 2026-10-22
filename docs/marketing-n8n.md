# Marketing orchestration and publishing

> **Historical state, superseded by [#110](https://github.com/lukaskourilcz/own-dashboard/issues/110).** This page describes the October 2026 staging and n8n orchestration, retired on 2026-10-20 ([#113](https://github.com/lukaskourilcz/own-dashboard/issues/113)). The current plan is [`docs/reports/dneskai-instagram-2026-10-20.md`](reports/dneskai-instagram-2026-10-20.md). Retired exports are in [`workflows/marketing/retired/`](../workflows/marketing/retired/README.md); the staging inventory is [`marketing-staging-retired-2026-10.md`](marketing-staging-retired-2026-10.md).

**Routes retired, 2026-10-22 (audit findings cost-06, cost-07):** `POST /api/marketing/n8n` and
`POST /api/marketing/dneskai/collect` answer every method with `410` and `{"code":"route-retired"}`, before any
credential check. The approval route no longer notifies the n8n approval webhook, and `approval-notification.ts`
is deleted. `MARKETING_N8N_SECRET`, `MARKETING_N8N_APPROVAL_WEBHOOK_URL` and `MARKETING_N8N_WEBHOOK_SECRET` open
nothing. The operations described below are history; none of them runs.

**Scheduling update, 2026-10-20 ([#120](https://github.com/lukaskourilcz/own-dashboard/issues/120)):** n8n no longer
times anything for DNESKAi. Supabase pg_cron calls `POST /api/marketing/tick`; see
[marketing scheduling](marketing-scheduling.md). The two timers below moved to `workflows/marketing/retired/`.

**DNESKAi update, 2026-10-13:** new collection used
`workflows/marketing/retired/dneskai-source-collection.json` at 22:00 Europe/Prague, targeting
four distinct next-day topics. See [collection and rotation](dneskai-source-collection.md).
The older `retired/daily-preparation.json` below is a retained inactive article-generation
workflow, not the new collection schedule. Do not activate both as competing daily plans.
Topic selection never approves a final social revision.

The four original exports described below under `workflows/marketing/` are inactive. They prepare or inspect owner-scoped
marketing work through OwnDashboard's authenticated API. The publishing export sends `dryRun:true`.
No workflow, account, publisher or paid plan was activated while building these files.

## Import and credentials

Import the JSON files into the owner's existing n8n Cloud workspace and keep them unpublished:

- `retired/daily-preparation.json`: at 07:00 Prague time, discover real sources and the next day's actual
  active calendar entries, enqueue at most eight idempotent slots, execute accepted jobs and read
  their saved status. Calendar entries determine date/time/platform; the workflow invents no slot.
- `retired/approved-publisher.json` (retired by #120): an authenticated approval webhook and one hourly recovery execution query
  the server's approved publication plan. At most eight exact publication IDs within the next 24 hours
  enter a batch-size-one loop, sorted by UTC schedule. Each waits until its exact slot and calls the
  publisher with that ID and `dryRun:true`. Known ambiguous outcomes and HTTP uncertainty enter
  read-only reconciliation for that exact ID; the publishing operation is never retried.
- `knowledge-processing.json`: at 08:00 and 20:00 Prague time, read up to five exact owner-consented
  queued/registered sources. Launch once or poll an existing run; provider launch retries are disabled.
  Manual runs support the pilot. A failed or ambiguous launch stays held for manual reconciliation,
  and cancelled sources are never resumed.
- `retired/source-reconciliation.json`: manual discovery and refresh of at most 20 actual source identities.
  Missing or unapproved material produces no fabricated source or fallback story.

Replace `https://own-dashboard.example.invalid` with the verified OwnDashboard host. Replace the
placeholder credential reference with an n8n **Header Auth** credential: header `Authorization`,
value `Bearer <MARKETING_N8N_SECRET>`. Put that value in n8n's credential manager only. It binds to
the fixed owner configured on the server. The exports contain no token values or account credentials.
The publisher's incoming Webhook uses a second Header Auth credential named **OwnDashboard
approval webhook** with its own placeholder ID. Its `Authorization: Bearer <MARKETING_N8N_WEBHOOK_SECRET>`
value must differ from the outbound API secret. Set server-only `MARKETING_N8N_APPROVAL_WEBHOOK_URL`
to the verified n8n production URL for `/webhook/marketing-approved-publication`; keep the export inactive until that host and inbound
credential are verified. The server notifies only the publication ID after its atomic approval commits.
The hook accepts only `{publicationId}` and requeries `publication-plan`; incoming data cannot confer
approval, choose an account, supply asset URLs, or override the schedule. Its immediate response
acknowledges receipt, not a publication result. Hourly recovery also queries the server when a hook
was missed. Late approval may miss the 15-minute publish window if the hook is unavailable; that remains
held rather than pretending to recover on time.

n8n documents generic [Header Auth credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/)
and [HTTP Request authentication, redirects and timeouts](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/).

HTTP Request nodes use verified supported version 4.2, Schedule Trigger 1.2 and Code 2. These are
supported entries in n8n's current official source ([HTTP Request](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/HttpRequest/HttpRequest.node.ts),
[Schedule Trigger](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Schedule/ScheduleTrigger.node.ts),
[Code](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Code/Code.node.ts)), checked
2026-10-13. Code nodes only map bounded data. HTTP nodes perform all network access; no Execute
Command, external code runner or native LangSmith tracing assumption appears in these exports.
The added Webhook 2.1, Wait 1.1, Loop Over Items 3, and If 2.2 versions are supported in official
source ([Webhook](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Webhook/Webhook.node.ts),
[Wait](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Wait/Wait.node.ts),
[Loop](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/SplitInBatches/v3/SplitInBatchesV3.node.ts),
[If](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/If/If.node.ts)), checked 2026-10-13.
The loop processes one slot at a time in the same workflow execution; the done output terminates.

The [Wait node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/) uses server time,
independent of workflow timezone. The planner normalizes server `scheduledAt` to an ISO UTC timestamp
and sets `resume:specificTime` / `dateTime`. For waits of at least 65 seconds, n8n offloads execution data
to its database and resumes it later. Short waits remain in memory. The slot payload contains only
publication ID, brand and UTC time, and mapping drops incoming header/body fields. Wait also persists
upstream execution context: disabling execution history is not proof that paused runs retain no
webhook headers. Inspect Cloud paused-data redaction/retention and import behavior before activation.
No long-wait/resume or restart recovery has been exercised on the owner's instance.

The workflows disable saved success/error payloads and manual execution data. The owner should
verify those imported [workflow settings](https://docs.n8n.io/workflows/settings/) and the workspace's
access controls. Read redacted OwnDashboard job/publication records for diagnostics. The generation
service owns bounded Claude/LangChain calls and redacted LangSmith traces; see [generation](marketing-generation.md).

## Native HTTP operations

POST `/api/marketing/n8n` with the Header Auth credential. The server chooses the owner; requests
cannot supply an owner ID. Operations are:

| Operation | Input and behavior |
| --- | --- |
| `discover` | `brand`, optional `date` (`YYYY-MM-DD`) and cursor; refresh real sources and return actual active calendar entries plus packets/holds. |
| `refresh` | `brand`, 1–20 `sourceIds`; recheck the authoritative producer and retain explicit unavailable/retired states. |
| `enqueue` | `brand`, actual `entryId`, `platform`; the server resolves its active campaign, exact Prague slot, verified account, current eligible source and approved template. Slot date/platform/generation version makes retries idempotent; rebinding supersedes old prepared revisions. |
| `knowledge-queue` | Read up to five queued/analyzing knowledge identities, with no source text. |
| `knowledge-run`, `knowledge-poll`, `knowledge-abort` | Exact owned `sourceId`; execute only the stored reviewed consent/budget, poll the registered provider run, or abort it. Worker is gated by `MARKETING_KNOWLEDGE_WORKER_ENABLED`. |
| `execute` | Saved `jobId`; run the bounded durable generation worker. The workflow disables automatic retries and queries status after any uncertain response. |
| `status` | Original saved `jobId`; read the recorded job outcome. |
| `publication-plan` | Optional exact `publicationId` or `brand`; requery owned queued publications with exact approved hash, ready assets, and a future schedule within 24 hours; return up to eight `{publicationId,brand,scheduledAt}` rows. A hook provides no approval evidence. |
| `publish` | `brand`, optional exact `publicationId`, `dryRun:true` by default; the server selects and rechecks due publications. It requires a separate approval of the complete revision and final assets. `preflight:true` (only with a dry run) adds the read-only Meta checks described below. |
| `reconcile` | Actual returned `publicationId`, or `brand` after timeout; query recorded remote state without creating or publishing another container. |

Read/refresh/status/reconcile and idempotent enqueue requests allow three HTTP attempts with a
one-second delay. Execute and publish have retries disabled. Their error outputs lead to saved-state
queries. Requests time out after 60 seconds; the server caps producer and Meta work at 55 seconds.
An empty calendar, missing source, unavailable service or disabled account remains held.

## Execution budget and setup limits

The exports replace five-minute publishing and ten-minute knowledge polling with one hourly planner,
one daily preparation run, and two daily knowledge runs. On a 30-day planning horizon that is
`720 + 30 + 60 = 810` scheduled executions, before approval webhooks, manual pilots, other workspace
workflows or retries at the workflow level. Each approval webhook starts another execution; fewer
than 190 such executions leaves room below a hypothetical 1,000-execution ceiling only if nothing
else consumes the remaining budget. A 31-day horizon uses 837 scheduled executions. This is a budget
projection, not measured account usage or a promise of a free ongoing plan.

Current [n8n trial documentation](https://docs.n8n.io/deploy/use-n8n-cloud/start-your-free-trial.md)
describes a 14-day trial capped at 1,000 executions; it is not a renewable monthly allowance.
The [pricing page](https://n8n.io/pricing/) confirms trial limits and execution-based accounting.
Verify the owner's actual plan, trial expiry, remaining executions, concurrent waiting-run behavior,
and runtime limits before import validation or activation. No subscription, upgrade, provisioning,
workflow import or activation is included here.

## Authoritative source refresh

Configure server-only producer credentials:

| Brand | URL and credential |
| --- | --- |
| DNESKAi | `MARKETING_DNESKAI_SOURCE_URL=https://<quorum>/admin/api/marketing-source`; `MARKETING_DNESKAI_SOURCE_SECRET` matches Quorum's DNESKAi integration secret. |
| devShark | `MARKETING_DEVSHARK_SOURCE_URL=https://<devshark>/api/quiz/questions`; `MARKETING_DEVSHARK_SOURCE_SECRET` matches `DEVSHARK_MARKETING_EXPORT_SECRET`. |

Both secrets need at least 32 characters. DNESKAi requests sign the exact POST body with the
existing timestamp/HMAC contract. An article status with a null packet, or an unapproved status
carrying an eligible packet, fails closed. Article approval grants no social approval.

devShark requests use `resource=marketing-source`, bounded `limit=20` and its integration Bearer.
A stored `/daily/YYYY-MM-DD` canonical URL rechecks with `daily=<that exact date>`; a generic
source rechecks with `sourceId=<id>`. A dated daily packet cannot silently become the generic bank
version or today's different question. Source deletion, timeout, stale observation, invalid hash,
brand mismatch and changed identity produce a hold/error. A stored database head is never a
replacement for a failed live read. An explicit producer retirement keeps its safe authored
content and returns `eligible:false`.

## Meta boundary

Research checked on 2026-10-13: Meta's developer documentation returned HTTP 429, so the adapter
uses Meta's own maintained Postman collections as primary references. The official
[Instagram collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
documents container creation, status and `media_publish`, the professional-account requirement,
and distinct Instagram/Facebook login permission families. The official
[Threads collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)
documents separate creation/publishing, text/image/video/carousel containers and publishing status.
The adapter omits Threads' optional automatic text publication flag.

The server selects one explicitly configured login mode per account. It does not choose a default
API version. For each `MARKETING_<DNESKAI|DEVSHARK>_<INSTAGRAM|THREADS>` prefix, configure
`API_VERSION`, `API_VERSION_VERIFIED_AT`, `LOGIN_MODE` for Instagram, `ACCESS_TOKEN`,
`TOKEN_EXPIRES_AT`, and comma-separated `VERIFIED_SCOPES`. Verify the actual app/account's supported
version, identity, token expiry and granted publishing scopes before recording these values.
Instagram Login uses `instagram_business_basic` and `instagram_business_content_publish`;
Facebook Login uses the corresponding Instagram/Page permission family. Threads uses
`threads_basic` and `threads_content_publish`. Request no messages, comments, ads or analytics
scopes for this adapter. Keep tokens on the server.

Since #121 the environment `ACCESS_TOKEN` is the bootstrap value. The owner's **Verify account**
button (`POST /api/marketing/accounts/verify`) stores it in `marketing_account_tokens`, and the
publisher and reconciliation use the stored token while it is unexpired. A missing, expired or
unreadable credential holds with `access-token-missing`, `access-token-expired`,
`access-token-expiry-unverified` or `credential-store-unavailable` before any Graph request. A live
run resolves the credential before `marketing_claim_due`, so such a hold leaves the publication
queued and unclaimed rather than recording it as failed.
`refreshInstagramToken` renews an Instagram Login token that is at least 24 hours old. Owner setup:
[external setup §11](external-setup.md#11-instagram-publishing-for-dneskai-121).

`MARKETING_PUBLISH_ENABLED` and each `MARKETING_<BRAND>_PUBLISH_ENABLED` flag must remain false
until the owner authorizes cutover. Each account also requires `enabled=true` and a recorded
verification. `MARKETING_APPROVED_ASSET_HOSTS` declares the exact public final-asset hosts.

A plain dry run makes no request. A preflight (`publish` with `dryRun:true, preflight:true`) runs
the same gate except those two switches, then reads the remote profile, downloads and decodes
every asset and reads the publishing quota. It stops before the first container: no POST,
no claim and no checkpoint. A switch that is still off comes back in `advisories`
(`account-disabled`, `publishing-disabled`) with `status:"dry-run"`, so the verified, disabled
account from #121 can be checked before the pilot. Any other failed check is a `held` result with
its code and is not recorded.

The adapter verifies the complete revision hash against both stored content hash and approval,
the approved remote account ID/handle, ready final assets and exact source identity/revision/hash.
Sources need an observation within 15 minutes and valid eligibility/expiry. The publication slot
must be due and no more than 15 minutes late. The caller supplies a current leased claim and a
database revalidation callback before publishing. The adapter downloads final assets without
credentials or redirects, checks declared MIME and SHA-256 bytes, and refuses unapproved hosts.

It reads the authenticated remote profile and provider-returned quota configuration before
container creation. It infers no quota number from advertised documentation: `quota_total` is
authoritative, a missing value holds with `publishing-quota-unavailable` and a full quota with
`publishing-quota-exhausted`. With Instagram Login the profile check compares the professional
`user_id`, not the app-scoped `id`. Every Instagram feed image is decoded from the downloaded
bytes before any container exists: JPEG, sRGB, 320–1440 px wide, 4:5 to 1.91:1, at most 8 MiB and
the declared size. Each image child and each single image carries its `alt_text` (at most 1,000
characters). `collaborators` (at most three usernames) go on the post only when the revision
records them. A single image uses the default image container: `image_url` without `media_type`
or children. It creates the child and parent containers, persists the parent container ID, polls
at most three times, revalidates current authority, and persists the publish intent before
`media_publish` or `threads_publish`. The publish intent is the only durable intent: containers are
unpublished drafts that expire on Meta's side, so creating them again never posts twice. The
database checkpoint must compare the expected old container/error fields and require the still-valid
claim. A lost fence causes no second outcome write.

A failure before the publish intent never goes to reconciliation (audit finding approval-04). A
transient one (no or uncertain answer, HTTP 5xx or 429, an unreadable answer or missing container ID,
the run deadline, a failed revalidation read) checkpoints `container-retry`: the claimed publication
forgets its container, and the next tick inside the claim runs every gate again (approval hash,
account, token, freshness, downloaded bytes, quota) and recreates all containers. A definite rejection
(another 4xx) is recorded as `failed`. An unfinished known container stays pending. A container in
`ERROR` or `EXPIRED` before any publish request is recorded as `failed` (`container-error`,
`container-expired`). After the publish intent, a publish timeout, uncertain response or failed receipt
keeps reconciliation state and the known IDs; `media_publish` is sent at most once per publication.
A reconciliation row without a numeric container ID, media ID, URL or publish intent provably
published nothing; the owner can give up on it and queue the approved post again
(`POST /api/marketing/publications`, see [external setup §11](external-setup.md)). Missing
permalink lookup retains the media ID and remains reconciliation; it does not announce a verified
public post. A previously attempted publish, recorded media ID or reconciliation record performs
only GET queries.

For an Instagram feed post without a retained media ID, reconciliation re-reads the stored
container and, unless Meta reports it `FINISHED`, `IN_PROGRESS`, `ERROR` or `EXPIRED`, reads
`GET /<ig-user-id>/media?fields=id,caption,timestamp,permalink,media_type&since=<slot − 5 min>&until=<slot + 20 min>`
(or one minute after the current time, if that is earlier), one page of 50.
It records the post as published only when exactly one item has the expected media type
(`CAROUSEL_ALBUM`, `IMAGE` or `VIDEO`), a timestamp between five minutes before and twenty minutes
after the slot, and the approved caption's first 100 characters as its prefix. Two matches stay in
reconciliation as `remote-media-match-ambiguous`. A full page that has a next page stays as
`remote-media-list-incomplete`, even with one match, because the next page could hold a second
one. No match keeps the container-based code. It
never sends a second `media_publish`. Stories keep their stricter rule: only the account's active
Story edge confirms a recorded media ID.

Supported publishing formats are Instagram JPEG post/carousel and MP4 Reel, plus Threads
text/image/video/carousel. The contract caps carousels at ten assets. Instagram Stories remain
held until account-specific format eligibility and delivery receive their own verification.
Automatic devShark discovery persists its bounded next-page cursor in owner-scoped events, so the next
20-source request continues instead of repeating the first page. Only a typed producer 409 stale-cursor
response resets discovery once; timeouts, malformed responses and other failures preserve the cursor
and fail closed. Targeted source refresh never resets the discovery cursor. Execution and publication
still recheck each exact source.

No live Meta or producer request ran during implementation tests. Setup, n8n import validation,
the real approved-content pilot and actual account publishing remain unverified.
