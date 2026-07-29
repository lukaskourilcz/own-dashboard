# AI and privacy

OwnDashboard uses no LLM-backed AI. The AI-links Auto-fill route is the only remaining "AI"-badged surface, and it is deterministic page reading — no model calls, no owner-data context sent anywhere.

## Current AI actions

- Link enrichment reads the target URL through Jina Reader (https://r.jina.ai) and returns the page's title and description for the user to review before saving.

## Write controls

- Link enrichment fills an existing form; the user still saves it.
- Opportunity-to-project conversion is deterministic, not AI-driven, and requires confirmation.

## Data boundaries

Link enrichment sends only the URL the user submitted to Jina Reader. Owner data (records, notes, projects, invoices, transactions, tasks) is never sent to any external model or reader. AI routes are rate-limited.

Invoice PDF extraction is deliberately not an AI workflow. The PDF is read locally in the browser with `pdf.js`, deterministic parsing fills the editable invoice form, and the file itself is neither uploaded nor stored.

Provider configuration is limited to the optional `JINA_API_KEY`, which only raises Jina's anonymous rate limit. The Anthropic SDK and every Claude-backed route (project copilot, career copilot, weekly brief, knowledge review, quick-add intent, AI search) were removed in the drop-AI-features commit.
