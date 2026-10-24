# AI and privacy

The owner explicitly authorized model-backed marketing on 2026-10-13 in issue #93. This permission is restricted to the Marketing workspace. Existing link enrichment, Career, invoices, finances and other areas retain their deterministic boundaries.

## Current AI actions

- Link enrichment reads the target URL through Jina Reader (https://r.jina.ai) and returns the page's title and description for the user to review before saving.
- Career's saved-position URL import (`/api/jobs/enrich`) reads a job posting through the same reader and fills the title, company and description fields for review.
- DNESKAi topic briefs (#210, behind `DNESKAI_TOPIC_BRIEFS_ENABLED`) read the stored URL of an approved link-library or manual topic through the same reader, server-side, to write the post's source text. Only that URL is sent.

## Write controls

- Link enrichment fills an existing form; the user still saves it.
- Opportunity-to-project conversion is deterministic, not AI-driven, and requires confirmation.

## Data boundaries

Every caller sends Jina Reader only a URL: the one the user submitted, or the one an approved topic stores. The Tools section reads `about-project.md` or `package.json` from the owner's own repositories through GitHub with the owner's token on the server and parses them as text; nothing is sent to a model. Owner data (records, notes, projects, invoices, transactions, tasks) is never sent to any external model or reader. AI routes are rate-limited.

Invoice PDF extraction is deliberately not an AI workflow. The PDF is read locally in the browser with `pdf.js`, deterministic parsing fills the editable invoice form, and the file itself is neither uploaded nor stored.

Outside Marketing, provider configuration is limited to the optional `JINA_API_KEY`, which only raises Jina's anonymous rate limit. The earlier project copilot, career copilot, weekly brief, knowledge review, quick-add intent and AI search routes remain removed. The Anthropic SDK is present for the separately authorized Marketing workflows below.

## Public tour isolation

`/guest` renders deterministic fixtures in a separate React Query cache. Its network boundary blocks application API requests, Supabase requests, exports, sign-out submissions and provider-linking actions even when the browser already has the owner's session. The boundary remains active during in-shell navigation and restores normal request behavior when the tour unmounts. Static assets and ordinary sign-in navigation remain available. Fixture entity stores never refetch live records. `/dev-preview` uses the same isolation with a real backend; interactions may use mocked requests only with the deliberately nonexistent E2E backend (`https://example.supabase.co`).

## Optional browser analytics

When `NEXT_PUBLIC_POSTHOG_KEY` is unset, the root provider does not import or initialize PostHog. When configured, it captures page views and page leaves through an allowlist of technical properties. URL credentials, queries, fragments, project slugs and UUIDs are redacted. Automatic click capture, person profiles, session replay and remote feature-flag configuration are disabled. It uses localStorage persistence; the default ingestion host is EU. This configuration alone does not establish consent or legal compliance. SDK loading/initialization failure does not block the application. See the provider’s [collection controls](https://posthog.com/docs/privacy/data-collection).

## Optional error monitoring

Without a Sentry DSN, runtime instrumentation does not import or initialize the SDK. Configured installations retain technical errors and sample traces at 10%; replay is disabled. Explicit SDK collection controls disable user information, cookies, HTTP headers/bodies, query parameters, database query data, GraphQL documents/variables, model inputs/outputs, local variables and source-context lines. Export filters remove arbitrary error extras, console/click breadcrumbs and sensitive span attributes, and sanitize URLs including Fio’s credential-bearing paths. Calendar rejection diagnostics contain only a fixed operation code and HTTP status.

Sentry sends directly to its ingestion host; there is no application tunnel. Browser blockers may prevent delivery. Diagnostic loading or capture failure must not replace the application response. These controls reduce collection but cannot prove arbitrary application error text contains no private data; keep errors technical and inspect configured events before broad use. See Sentry’s [collection categories](https://docs.sentry.io/platforms/javascript/guides/nextjs/data-management/data-collected/).

## Marketing-only exception (2026-10-13)

The owner also requested DNESKAi source rotation and Jev classification on this date.
The collection service may send bounded public source texts and public candidate history
to TypeSafe only after its separate provider configuration and budget admission pass.
It does not send owner notes, financial data, credentials or unrelated project records.
The Topic recovery panel (`⋯` → Obnova témat) holds research candidates; selection grants no editorial or social
approval. Missing credentials, uncertain provider spend and duplicate uncertainty remain
visible holds. The earlier disposable pilot does not authorize new collection spend.

Supabase pg_cron schedules the DNESKAi chain through one signed tick endpoint ([marketing scheduling](marketing-scheduling.md)); the tick sends nothing to a model or provider that the owning step would not send on its own. n8n Cloud orchestrates the remaining versioned authenticated HTTP operations (devShark and the knowledge import). Supabase owns the source heads, jobs, exact content revisions, approvals and publication receipts. Claude Design exports are reviewed template sources; the renderer runs fixed code and never executes exported or model-generated scripts. Dots and Higgsfield are excluded.

With `MARKETING_AI_CONSENT=true`, the server may send selected public editorial evidence, authored effective questions or active coding-task specifications and explicitly reviewed presentation advice to Anthropic. For a DNESKAi brief it sends the evidence titles, bounded excerpts, publisher names and publication dates, and each source picture's sha256, credit, size and origin kind; never the picture bytes, any URL or presentation advice. It never sends learner records, invoices, account credentials, cookies or unrelated projects. Individual Saved-source analysis additionally requires the exact owner-reviewed plan and budget stored by the knowledge import form. Capture alone starts no paid call. Source text is untrusted data, never executable instructions. Missing speech, timecodes and saved dates remain missing.

**FACT or HYPE (#152).** With `DNESKAI_FACT_OR_HYPE_ENABLED=true` (and scouting and `MARKETING_AI_CONSENT=true`), a scouted Instagram reel whose public caption names the FACT or HYPE series gets two paid calls. Apify's reel scraper receives only the reel's public URL and returns its public transcript; Anthropic (Claude Haiku 5.5 by default, `MARKETING_DNESKAI_TOPIC_MODEL`) then receives only that caption and transcript, as untrusted data, and returns the tool's name, a verdict, one sentence of reason and any stated price. No commenter data, no owner data, no other post and no picture goes to either provider. The transcript and its sha256 stay in the topic's evidence.

**Titling (#153).** With `DNESKAI_TITLING_ENABLED=true` and `MARKETING_AI_CONSENT=true`, one call a night sends Anthropic (Claude Haiku 5.5 by default) up to 40 untitled topics, each as its source title, kind and an excerpt of at most 600 characters from the public report, reel caption or the owner's own library note, as untrusted data. It returns a Czech working title, a summary sentence, a keyword and the kind. Nothing else about the owner, no commenter data and no picture is sent.

**Owner-written notes (owner decision 8, 22 October 2026).** „Regenerate with a note“ in the DNESKAi review sends the note the owner types (at most 1,000 characters) to Anthropic as part of that one brief's drafting call, beside the brief's evidence, with an instruction that it steers wording and never counts as evidence. It is the owner's own text written for the marketing workflow, sent only when the owner presses the button. The note is stored in the drafting job's request (`marketing_jobs`, owner-only) and, for a post still in review, as the return feedback on the replaced revision. LangSmith receives only its SHA-256 hash (`owner_note_hash`) and the replaced revision's id. „Generate now“ sends nothing the scheduled drafting would not send.

**Comment replies (#160).** With `DNESKAI_ENGAGEMENT_ENABLED=true` and the account's reply switch on, the scheduler reads the comments under @dneskai's posts of the last seven days and matches them against the post's approved keyword in memory. For a match it stores Instagram's comment id, the media id, the keyword and the reply's status and time (`marketing_instagram_comment_replies`). It stores no commenter username, user id or comment text. The DM and the public reply are the owner's approved words; no model sees a comment. The comment webhook (#161) receives the same comment payload from Meta, checks its signature, reads only the comment id, the media id and the text in memory, and stores nothing more than polling does.

**Trending sounds (#167).** With `DNESKAI_AUDIO_TRENDS_ENABLED=true` under Facebook Login, the daily tick asks Meta's Audio API for the sounds @dneskai may use and stores their ids, titles, artists, lengths and cover thumbnails. With `DNESKAI_TIKTOK_TRENDS_ENABLED=true`, Apify's TikTok trends actor receives only a fixed input (Czech sounds on the surging chart) and returns public chart rows; the tick searches Meta's Audio API for those titles and stores only a `tiktok` mark on matching rows. No owner data goes to either provider, and no model is involved.

LangSmith is separately opt-in. Only hashes, technical versions, brand, usage, timing, issue codes, counts (slides per type, pictures, owner edit kinds) and the exact owner decision with its score are sent to its EU endpoint; raw prompts, captions, slide text, picture credits, source text, feedback text, URLs, signed asset URLs and credentials are excluded. The owner-edits evaluation set keeps the generated and edited wording in a local file; its optional upload carries only hashes, edit-kind counts, character deltas and scores ([generation](marketing-generation.md#owner-edits-evaluation-set)). Diagnostic failure cannot grant content approval or bypass publication checks. The original source, final assets, caption, destination and schedule remain in owner-only storage. Post approval happens only in OwnDashboard and binds the exact revision hash; edits create a fresh unapproved revision.

For selected DNESKAi topics only, the media collector downloads the source pictures (Instagram CDN links from the collection, or one read of the public article page and its images on the publisher's own hosts) through the free-feeds HTTPS, DNS and size guards. The scheduler's `media` step runs it after each collection run. No model sees them at this step. The original bytes go to the private, owner-prefixed `marketing-media` bucket with origin and credit; one-hour signed links serve the owner's preview only. See [DNESKAi source media](dneskai-source-media.md).

Private `marketing-assets` storage contains immutable owner-prefixed JPEGs. Seven-day signed URLs are issued only for slots within six days; the publisher verifies the reachable bytes against approved hashes immediately before sending. No browser receives service-role credentials. Publication starts paused globally and per brand, and requires a verified enabled profile and current live source checks. Ambiguous remote replies enter reconciliation without automatic resending.
