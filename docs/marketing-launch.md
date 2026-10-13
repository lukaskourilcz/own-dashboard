# Marketing implementation and launch review

Owner request: own-dashboard#93. Implementation spans OwnDashboard, quorum#598 and react-express-app#364. Dots and Higgsfield are excluded. Daily final-post approval belongs only to OwnDashboard. This document is a deployment/pilot checklist, not permission to deploy or publish.

## Reviewable result

OwnDashboard contains Marketing review/calendar/knowledge/results tabs, strict portable contracts, isolated owner-readable tables, service-only durable workers, exact-revision approval, fenced publication intents/receipts and private verified JPEG storage. The complete repository calendars are retained as139 DNESKAi and156 devShark entries. Import prepares18 October–16 November2026 drafts, preserves originals and holds dated offers/events or ambiguous knowledge references for review. Prague09:00 changes from07:00UTC to08:00UTC on25 October; ambiguous local02:30 is rejected.

quorum exports existing final BoardlessAI editorial packets and tombstones through a signed integration route. It keeps old social publishers paused. devShark exports the current effective curated question bank plus DB edits/deletions and active public coding tasks. It never exports hidden grading tests or solutions. Article/template/account/plan approval never approves a future social post.

Claude Design exports author versioned layouts, then the deterministic renderer fills them with source-bound copy. There is no invented Claude Design render API. Both actual exported template adaptations remain unapproved. LangChain calls Claude with strict structured output and bounded usage; LangSmith EU receives only redacted hashes/versions/usage and exact owner feedback. Tracing failure cannot permit publication or block an already-authorized send.

## Evidence and its limits

- The complete local render→exact approval→exclusive claim→durable intents→receipt test uses actual renderer/database/publisher code, but explicitly mocked Claude, storage and Meta boundaries. Preview bytes equal approved asset hashes; no Meta calls occur before approval; double approval produces one publication. See [offline proof](marketing-pipeline-verification.md).
- The offline benchmark has45 cases, including source/brand/answer/rendering/redaction/retry limits. No paid judge or real model cost was measured. It is not a general factual-entailment evaluator.
- A separate local producer pilot used the actual485-row devShark deletion snapshot read from its connected database. The previous question `rm-js-1` is deleted. `rm-js-17` was not deleted, and active `js-digit-sum` produced source-bound4/3-slide previews. This validates the local producer plus that DB snapshot; deployed source-API freshness and owner template approval remain unverified. Private pilot artifacts are deliberately absent from this public repo.
- The existing Sep15 Apify dataset has33 unique URLs,32 nonempty transcripts, one restricted source, no OCR and no Saved timestamps. The original provider receipt is retained privately; it is no estimate for a future run. The21-day import excludes unknown/unverified dates by default. Supply actual Instagram Saved JSON and timestamp proof, or explicitly opt into unknown dates; do not infer Saved date from publication date.
- The inspected BoardlessAI review state has no final article selection. Its held article preview is design/layout evidence, not factual or editorial approval.

## Configuration, without putting secrets in GitHub or chat

| Boundary | Required private configuration |
| --- | --- |
| OwnDashboard identity/database | Verified staging Supabase URL/anon/service-role credentials, actual owner auth UUID as `MARKETING_OWNER_ID`; apply the four new migrations only after deployment review. |
| n8n→OwnDashboard | Separate32+character `MARKETING_N8N_SECRET`, Header Auth credential `Authorization: Bearer …`; native HTTP operation `/api/marketing/n8n`. |
| OwnDashboard→n8n approval event | `MARKETING_N8N_APPROVAL_WEBHOOK_URL` on the existing n8n host's production `/webhook/…` path; separate `MARKETING_N8N_WEBHOOK_SECRET` in server env and incoming Header Auth credential. Only a publication UUID is sent. Native API rechecks exact owner approval before planning/sending. |
| DNESKAi source | `MARKETING_DNESKAI_SOURCE_URL` ending `/admin/api/marketing-source`; matching server/quorum source secret; explicit producer enable flag. |
| devShark source | `MARKETING_DEVSHARK_SOURCE_URL` ending `/api/quiz/questions`; matching `DEVSHARK_MARKETING_EXPORT_SECRET`. Fresh DB override failure must hold, not use stale data. |
| Claude/LangChain | `ANTHROPIC_API_KEY`, verified `MARKETING_CLAUDE_MODEL`, `MARKETING_CLAUDE_INPUT_USD_PER_MTOK`/`MARKETING_CLAUDE_OUTPUT_USD_PER_MTOK` with verified current rates, `MARKETING_AI_CONSENT=true` only for this owner-requested marketing scope. Default max8 generation jobs/day and$0.25 admission estimate/job; this is not a provider-enforced account spend cap. Claude Max subscription is separate from API billing. |
| IG analysis | Reviewed current `APIFY_ACTOR_ID`, exact `APIFY_ACTOR_BUILD`, scoped `APIFY_TOKEN`; `MARKETING_KNOWLEDGE_WORKER_ENABLED=true` only after exact owner-consented source/provider/budget plans exist. Apify request contains explicit max charge, no automatic launch retry. |
| LangSmith | EU-only `LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com`, scoped `LANGSMITH_API_KEY`, isolated dev/prod project name, `MARKETING_LANGSMITH_ENABLED=true`. Keep global/native LangChain tracing disabled. Verify retention and paused n8n execution redaction before first real run. |
| Assets | Private `marketing-assets` bucket, fixed owner-prefixed immutable keys and exact Supabase host in `MARKETING_APPROVED_ASSET_HOSTS`. Final URL is part of the revision hash; changes require new approval. |
| Meta/Threads | Verified remote account ID/handle, exact supported API version + verification date, explicit Instagram login mode, granted publishing scopes, token/expiry per brand/channel. Tokens stay server-side. Set global/per-brand publish flags false and account enabled false until approved cutover. See [publisher runbook](marketing-n8n.md). |

Four credential-free n8n exports are inactive. The publisher is dry-run by default. Its authenticated approval webhook and UTC Wait node schedule the exact approved publication; hourly recovery reads up to8 sorted approvals. Lost responses use read-only reconciliation, never blind publish retries. Verify paused execution data because native Wait persists upstream context, including webhook-node context, even when Code output contains only ID/brand/time.

The [official n8n trial](https://docs.n8n.io/deploy/use-n8n-cloud/start-your-free-trial.md) allows14days/1000 executions. Base schedules project810 executions/30days before webhooks/manual/other workflows; a14-day trial cannot cover a30-day launch. Verify the actual account classification, exact expiry/renewal, usage, LangSmith entitlements/retention and API connectivity privately before activation. Account balances, current usage and billing details belong in the private setup record, not this public repository. No paid upgrade or credit purchase was made.

## Concrete launch sequence

1. Review the three PRs and actual template previews. Authorize a verified staging deployment; production remains unchanged. Back up the current database/calendar/publisher state and apply only the new migrations to staging.
2. Install private scoped credentials through service managers/server env, never chat/GitHub. Creating new security-sensitive access requires the owner's action-time approval in Chrome; payment/credit purchase or changing existing credentials must be completed by the owner.
3. All four n8n drafts have been imported and persisted inactive through native URL import; replace the placeholder OwnDashboard host with the verified deployed staging endpoint, assign named credentials and inspect native node versions/settings. Test actual import, disabled scheduling, auth/replay rejection, UTC Wait resume and paused-data redaction.
4. Select one actual final DNESKAi article in BoardlessAI. Discover one currently eligible devShark question and one active task through the deployed live source route. Revalidate source heads before and after generation. Feed one transcript-backed reviewed marketing procedure into presentation only.
5. Approve the exact Design-derived template digests. Generate bounded pilot drafts with known Claude usage, confirm EU traces/redaction and immutable stored JPEG bytes, inspect mobile/error/source-change behavior in the authenticated OwnDashboard.
6. In OwnDashboard inspect the exact final assets/caption/account/time and explicitly approve each pilot post. Only these approvals allow sends. Verify actual remote IDs/permalinks for each connected brand/channel; one channel's success cannot cause a retry of the other.
7. Only after the owner reviews those concrete results, confirm old publisher hold, import/review/activate the preserved30-day drafts and authorize production cutover. Enable schedules/accounts/publish flags separately. If readiness misses18 October, report it; never silently shift the requested campaign.

Rollback disables global/per-brand publishing, account enablement and n8n schedules. Keep original calendar snapshots, every content revision, asset hash, provider/container/media ID and receipt. Archived campaigns cannot acquire new work or publish intents. Already remote outcomes remain available for read-only reconciliation. Missed/ambiguous posts require a new approved window or reconciliation, not an unscheduled retry.
