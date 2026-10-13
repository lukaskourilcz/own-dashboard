# Marketing orchestration and publishing

The four exports under `workflows/marketing/` are inactive. They prepare or inspect owner-scoped
marketing work through OwnDashboard's authenticated API. The publishing export sends `dryRun:true`.
No workflow, account, publisher or paid plan was activated while building these files.

## Import and credentials

Import the JSON files into the owner's existing n8n Cloud workspace and keep them unpublished:

- `daily-preparation.json`: at 07:00 Prague time, discover real sources and the next day's actual
  active calendar entries, enqueue at most eight idempotent slots, execute accepted jobs and read
  their saved status. Calendar entries determine date/time/platform; the workflow invents no slot.
- `approved-publisher.json`: an authenticated approval webhook and one hourly recovery execution query
  the server's approved publication plan. At most eight exact publication IDs within the next 24 hours
  enter a batch-size-one loop, sorted by UTC schedule. Each waits until its exact slot and calls the
  publisher with that ID and `dryRun:true`. Known ambiguous outcomes and HTTP uncertainty enter
  read-only reconciliation for that exact ID; the publishing operation is never retried.
- `knowledge-processing.json`: at 08:00 and 20:00 Prague time, read up to five exact owner-consented
  queued/registered sources. Launch once or poll an existing run; provider launch retries are disabled.
  Manual runs support the pilot. A failed or ambiguous launch stays held for manual reconciliation,
  and cancelled sources are never resumed.
- `source-reconciliation.json`: manual discovery and refresh of at most 20 actual source identities.
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
| `publish` | `brand`, optional exact `publicationId`, `dryRun:true` by default; the server selects and rechecks due publications. It requires a separate approval of the complete revision and final assets. |
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

`MARKETING_PUBLISH_ENABLED` and each `MARKETING_<BRAND>_PUBLISH_ENABLED` flag must remain false
until the owner authorizes cutover. Each account also requires `enabled=true` and a recorded
verification. `MARKETING_APPROVED_ASSET_HOSTS` declares the exact public final-asset hosts.

The adapter verifies the complete revision hash against both stored content hash and approval,
the approved remote account ID/handle, ready final assets and exact source identity/revision/hash.
Sources need an observation within 15 minutes and valid eligibility/expiry. The publication slot
must be due and no more than 15 minutes late. The caller supplies a current leased claim and a
database revalidation callback before publishing. The adapter downloads final assets without
credentials or redirects, checks declared MIME and SHA-256 bytes, and refuses unapproved hosts.

It reads the authenticated remote profile and provider-returned quota configuration before
container creation. It infers no quota number from advertised documentation. It persists a
container-create intent before the first POST, persists the returned container ID, polls at most
three times, revalidates current authority, and persists publish intent before `media_publish` or
`threads_publish`. The database checkpoint must compare the expected old container/error fields
and require the still-valid claim. A lost fence causes no second outcome write.

An unfinished known container stays pending. A publish timeout, uncertain response or failed
receipt keeps reconciliation state and the known IDs. Missing permalink lookup retains the media
ID and remains reconciliation; it does not announce a verified public post. A previously attempted
publish, recorded media ID or reconciliation record performs only GET queries. If the provider
reports PUBLISHED without a retained media ID, the operator must reconcile that actual ID; the
adapter does not guess from similar captions or publish again.

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
