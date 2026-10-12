# Marketing orchestration and publishing

The three exports under `workflows/marketing/` are inactive. They prepare or inspect owner-scoped
marketing work through OwnDashboard's authenticated API. The publishing export sends `dryRun:true`.
No workflow, account, publisher or paid plan was activated while building these files.

## Import and credentials

Import the JSON files into the owner's existing n8n Cloud workspace and keep them unpublished:

- `daily-preparation.json`: at 07:00 Prague time, discover real sources and the next day's actual
  active calendar entries, enqueue at most eight idempotent slots, execute accepted jobs and read
  their saved status. Calendar entries determine date/time/platform; the workflow invents no slot.
- `approved-publisher.json`: every five minutes, inspect due owner-approved posts for each brand
  in dry run. Returned ambiguous publication IDs go to read-only reconciliation. A timeout queries
  the brand's recorded claimed/reconciliation rows instead of retrying the publishing operation.
- `source-reconciliation.json`: manual discovery and refresh of at most 20 actual source identities.
  Missing or unapproved material produces no fabricated source or fallback story.

Replace `https://own-dashboard.example.invalid` with the verified OwnDashboard host. Replace the
placeholder credential reference with an n8n **Header Auth** credential: header `Authorization`,
value `Bearer <MARKETING_N8N_SECRET>`. Put that value in n8n's credential manager only. It binds to
the fixed owner configured on the server. The exports contain no token values or account credentials.
n8n documents generic [Header Auth credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/)
and [HTTP Request authentication, redirects and timeouts](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/).

HTTP Request nodes use verified supported version 4.2, Schedule Trigger 1.2 and Code 2. These are
supported entries in n8n's current official source ([HTTP Request](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/HttpRequest/HttpRequest.node.ts),
[Schedule Trigger](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Schedule/ScheduleTrigger.node.ts),
[Code](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Code/Code.node.ts)), checked
2026-10-13. Code nodes only map bounded data. HTTP nodes perform all network access; no Execute
Command, external code runner or native LangSmith tracing assumption appears in these exports.

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
| `enqueue` | `brand`, actual `entryId`, `platform`; the server resolves its active campaign, exact Prague slot, verified account, current eligible source and approved template. Slot identity makes retries idempotent. |
| `execute` | Saved `jobId`; run the bounded durable generation worker. The workflow disables automatic retries and queries status after any uncertain response. |
| `status` | Original saved `jobId`; read the recorded job outcome. |
| `publish` | `brand`, `dryRun:true` by default; the server chooses due publications. It requires a separate approval of the complete revision and final assets. |
| `reconcile` | Actual returned `publicationId`, or `brand` after timeout; query recorded remote state without creating or publishing another container. |

Read/refresh/status/reconcile and idempotent enqueue requests allow three HTTP attempts with a
one-second delay. Execute and publish have retries disabled. Their error outputs lead to saved-state
queries. Requests time out after 60 seconds; the server caps producer and Meta work at 50 seconds.
An empty calendar, missing source, unavailable service or disabled account remains held.

## Authoritative source refresh

Configure server-only producer credentials:

| Brand | URL and credential |
| --- | --- |
| DNESKAi | `MARKETING_DNESKAI_SOURCE_URL=https://<quorum>/admin/api/marketing-source`; `MARKETING_DNESKAI_SOURCE_SECRET` matches Quorum's DNESKAi integration secret. |
| devShark | `MARKETING_DEVSHARK_SOURCE_URL=https://<devshark>/api/admin`; `MARKETING_DEVSHARK_SOURCE_SECRET` matches `DEVSHARK_MARKETING_EXPORT_SECRET`. |

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
No live Meta or producer request ran during implementation tests. Setup, n8n import validation,
the real approved-content pilot and actual account publishing remain unverified.
