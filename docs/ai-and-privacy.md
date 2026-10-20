# AI and privacy

The owner explicitly authorized model-backed marketing on 2026-10-13 in issue #93. This permission is restricted to the Marketing workspace. Existing link enrichment, Career, invoices, finances and other areas retain their deterministic boundaries.

## Current AI actions

- Link enrichment reads the target URL through Jina Reader (https://r.jina.ai) and returns the page's title and description for the user to review before saving.
- Career's saved-position URL import (`/api/jobs/enrich`) reads a job posting through the same reader and fills the title, company and description fields for review.

## Write controls

- Link enrichment fills an existing form; the user still saves it.
- Opportunity-to-project conversion is deterministic, not AI-driven, and requires confirmation.

## Data boundaries

Both routes send Jina Reader only the URL the user submitted. The Tools section reads `about-project.md` or `package.json` from the owner's own repositories through GitHub with the owner's token on the server and parses them as text; nothing is sent to a model. Owner data (records, notes, projects, invoices, transactions, tasks) is never sent to any external model or reader. AI routes are rate-limited.

Invoice PDF extraction is deliberately not an AI workflow. The PDF is read locally in the browser with `pdf.js`, deterministic parsing fills the editable invoice form, and the file itself is neither uploaded nor stored.

Provider configuration is limited to the optional `JINA_API_KEY`, which only raises Jina's anonymous rate limit. The Anthropic SDK and every Claude-backed route (project copilot, career copilot, weekly brief, knowledge review, quick-add intent, AI search) were removed in the drop-AI-features commit.

## Marketing-only exception (2026-10-13)

The owner also requested DNESKAi source rotation and Jev classification on this date.
The collection service may send bounded public source texts and public candidate history
to TypeSafe only after its separate provider configuration and budget admission pass.
It does not send owner notes, financial data, credentials or unrelated project records.
The Sources panel holds research candidates; selection grants no editorial or social
approval. Missing credentials, uncertain provider spend and duplicate uncertainty remain
visible holds. The earlier disposable pilot does not authorize new collection spend.

Supabase pg_cron schedules the DNESKAi chain through one signed tick endpoint ([marketing scheduling](marketing-scheduling.md)); the tick sends nothing to a model or provider that the owning step would not send on its own. n8n Cloud orchestrates the remaining versioned authenticated HTTP operations (devShark and the knowledge import). Supabase owns the source heads, jobs, exact content revisions, approvals and publication receipts. Claude Design exports are reviewed template sources; the renderer runs fixed code and never executes exported or model-generated scripts. Dots and Higgsfield are excluded.

With `MARKETING_AI_CONSENT=true`, the server may send selected public editorial evidence, authored effective questions or active coding-task specifications and explicitly reviewed presentation advice to Anthropic. It never sends learner records, invoices, account credentials, cookies or unrelated projects. Individual Saved-source analysis additionally requires the exact owner-reviewed plan and budget stored by the knowledge import form. Capture alone starts no paid call. Source text is untrusted data, never executable instructions. Missing speech, timecodes and saved dates remain missing.

LangSmith is separately opt-in. Only hashes, technical versions, brand, usage, timing, issue codes and the exact owner decision are sent to its EU endpoint; raw prompts, captions, source text, feedback text, signed asset URLs and credentials are excluded. Diagnostic failure cannot grant content approval or bypass publication checks. The original source, final assets, caption, destination and schedule remain in owner-only storage. Post approval happens only in OwnDashboard and binds the exact revision hash; edits create a fresh unapproved revision.

For selected DNESKAi topics only, the media collector downloads the source pictures (Instagram CDN links from the collection, or one read of the public article page and its images on the publisher's own hosts) through the free-feeds HTTPS, DNS and size guards. Nothing calls it yet: the scheduler (#120) will run it after each collection run. No model sees them at this step. The original bytes go to the private, owner-prefixed `marketing-media` bucket with origin and credit; one-hour signed links serve the owner's preview only. See [DNESKAi source media](dneskai-source-media.md).

Private `marketing-assets` storage contains immutable owner-prefixed JPEGs. Seven-day signed URLs are issued only for slots within six days; the publisher verifies the reachable bytes against approved hashes immediately before sending. No browser receives service-role credentials. Publication starts paused globally and per brand, and requires a verified enabled profile and current live source checks. Ambiguous remote replies enter reconciliation without automatic resending.
