# Marketing integration contract v1

Canonical runtime definitions: `src/lib/marketing/contracts.ts`. Producers emit `marketing-source/1`; prepared posts use `marketing-content/1`. Unknown fields and versions are rejected. Source packets never carry owner IDs, user records, credentials or hidden grading tests. The authenticated integration determines the owner on the receiving server.

Source packet fields: `schemaVersion`, `brand` (`dneskai`/`devshark`), `kind` (`article`/`question`/`coding-task`/`instagram-reference`), `sourceId`, `sourceRevision`, `contentHash` (lowercase SHA-256), `canonicalUrl` (HTTPS), `locale`, `observedAt` (ISO with offset), `expiresAt` (ISO or null), `eligible`, `eligibilityReason`, `content`.

Content fields: `title`, `body`, `category`, `difficulty` (string/null), `code` (string/null), `options` (array), `answer` (string/null), `explanation` (string/null), `evidence` (array), `image` (object/null). Evidence has `url`, `title`, `excerpt`, `checkedAt`, optional `timecodeSeconds`. Image has `url`, `alt`, `licence`. All fields other than timecode are required; use explicit null/empty arrays when inapplicable.

DNESKAi: kind article, locale cs, actual BoardlessAI selected article revision and citations. devShark: kind question/coding-task, locale en, effective current bank plus DB overrides and active eligibility. A question carries authored options, answer and explanation. A coding task carries only safe authored explanation, not hidden tests/server solutions. A unavailable effective source yields a held/error result, never an invented eligible packet.

`contentHash` hashes the `content` object only using SHA-256 UTF-8 canonical JSON: recursively sort object keys lexically; preserve array order and string bytes; no whitespace. `sourceRevision` identifies the full version including eligibility changes. Consumers verify hashes. A tombstone uses the same source ID, a new revision, `eligible=false`; retain content or the last safe authored version so it still validates. Consumers invalidate unposted dependent revisions on supersession/retirement.

Receiver: authenticated POST `/api/marketing/automation` body `{action:"source",packet:<SourcePacket>}`. Headers: Bearer integration secret, `X-Marketing-Timestamp` unix seconds, `X-Marketing-Signature` lowercase HMAC-SHA256 over `<timestamp>.<exact raw UTF-8 request body>`. Each producer gets its own secret bound server-side to a fixed brand/owner. A callback without valid signature, with wrong brand or more than five minutes old is refused. Replay suppression is keyed by source identity/revision/hash. Production endpoints and secret provisioning are setup actions, not included credentials.

OwnDashboard retains content revisions, approvals and publication records. The owner approves the exact hash of the full prepared revision, including asset hashes, account and scheduled time. Replacing a revision invalidates the prior approval. Sources are checked again before publication. Drafts without final assets cannot be approved for Instagram.

Core pipeline uses n8n Cloud, Claude Design templates, bounded LangChain generation and LangSmith diagnostics. Dots and Higgsfield are excluded.
