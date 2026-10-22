# Marketing worker protocol

## Current OwnDashboard path

The normal DNESKAi pipeline runs in OwnDashboard's Node routes and `src/lib/marketing` modules. `scheduler-ports.ts` connects collection, media, briefs and the durable `marketing_jobs` queue to the Supabase tick. `executeMarketingJob` claims the persisted job and uses the guarded generation/renderer adapters. No separately provisioned worker service or n8n timer is needed for that path. See [scheduling](../../docs/marketing-scheduling.md).

The prepared continuation adds strict brief `/2` evidence while keeping `/1` readable. Brief offers use a conservative bytes/2 token estimate plus fixed token overhead; dollar reservations remain byte-based, and token/cost/job ceilings are unchanged. A refused Apify start settles at zero only with a definite pre-request or typed official refusal; ambiguous starts retain their reservation. Free source reads may overlap up to three at a time, within five operations and 45 seconds. Paid starts stay serial.

These are local branch changes, with unapplied SQL migrations and unresolved production migration history. This document does not mark them deployed.

## HTTP protocol

`protocol.ts` exposes a Fetch-compatible authenticated HTTP handler and a separate durable job runner. OwnDashboard mounts them in its own Node routes, authenticated as the signed `worker` automation role: `POST /api/marketing/jobs` admits a job, `GET /api/marketing/jobs/<UUID>` reads it (both through `marketingJobsHttpHandler` in `src/lib/marketing/worker-runtime.ts`) and `POST /api/marketing/jobs/<UUID>/execute` runs it. `next.config.ts` traces the pinned fonts and template assets into the execute route. The DNESKAi tick does not go through HTTP: it calls `executeMarketingJob` in-process. No separate worker host is provisioned, and the DNESKAi path needs none.

POST the `marketing-job/1` envelope. Use the revision UUID as `idempotencyKey` and include `generation`. A template job (`MarketingWorkerRequestSchema`) also carries the exact approved `template`; the handler resolves that version through a trusted server registry and rejects a caller-supplied approval that differs from the registry. A DNESKAi deck job (`DneskaiDeckJobRequestSchema`) carries no template: the vendored carousel studio renders it, and its `templateVersion` must equal `DNESKAI_DECK_TEMPLATE_VERSION`. A durable queue must commit the immutable request and hash before the handler returns 202. Repeating a matching key and hash returns the original job (200); a changed hash must fail. GET `/jobs/<UUID>` returns scoped status/result. Authenticate both operations, bind the integration to its owner on the server, and use TLS. Do not put tokens in URLs.

Implement `DurableMarketingQueue` with owner-scoped persistence. Workers claim a job with a lease and fencing token, record a provider-attempt reservation before making a call, and commit a result only while their fencing token is current. A crash or expired lease after provider admission must move the job to reconciliation; automatic replay can incur another bill. Neither the HTTP handler nor the runner provides a queue, lock, scheduler, database or crash recovery. Never use an in-memory queue or `setTimeout` after an HTTP response as a production adapter.

The runner reloads the current source before generation and after rendering. Retired, expired, superseded or unavailable sources hold the job. Save the final revision plus slides and its final hash before returning `review`. Keep publishing in OwnDashboard's separate approval workflow. Store partial assets with a retention/garbage-collection policy; rendering/upload failure must not expose a partly prepared revision for approval.

Keep `ANTHROPIC_API_KEY` and `LANGSMITH_API_KEY` server-side. Configure a verified Claude model and current token rates. Disable global `LANGSMITH_TRACING` and `LANGCHAIN_TRACING_V2`: this worker uses the redacted SDK adapter. Set the EU endpoint and an EU LangSmith workspace explicitly. Every job requires marketing-source consent; project notes, financial records, learner responses and hidden solutions are outside this protocol.
