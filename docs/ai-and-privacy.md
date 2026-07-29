# AI and privacy

OwnDashboard uses AI only inside a visible workflow.

## Current AI actions

- Link enrichment proposes a short description, category, and pricing label from a URL the user submitted.
- Project Copilot produces facts, risks, suggestions, and record identifiers from one owned project's bounded context.
- Weekly operating brief produces the same structured sections from a bounded professional snapshot and places them in an editable review draft.
- Career Copilot compares one saved listing with bounded owned work evidence and returns gaps, suggestions, a cover-letter draft, and interview questions.
- Knowledge review proposes note, prompt, and link maintenance from bounded owned knowledge records.

There is no global assistant with implicit access to the full database. Every multi-record request is initiated from a named workflow, requires sensitive-context opt-in, and shows the user a confirmation before sending context.

## Write controls

- Link enrichment fills an existing form; the user still saves it.
- Opportunity-to-project conversion is deterministic, not AI-driven, and requires confirmation.
- Project and weekly briefs require explicit consent before the request. They do not write database rows.
- Owned-record search, Career Copilot, and knowledge review require explicit consent and are read-only. Their source identifiers are checked against the server-loaded records.
- A generated weekly brief is not saved or completed until the user chooses the separate review action.
- Career and knowledge output remains a proposal. Copying text does not create or update an application, note, prompt, or link.

## Data boundaries

AI can be disabled in Settings. Sensitive context is a separate preference and defaults off.

Project Copilot always includes a bounded set of project identity, tasks, costs, automations, opportunities, and dates. It includes note text and invoice metadata only when sensitive-context opt-in is on. The weekly brief, owned-record search, Career Copilot, and knowledge review are sensitive multi-domain operations and are unavailable until that opt-in is on. Queries are explicitly scoped by authenticated `user_id` and any selected entity id, source identifiers are derived from returned rows rather than model claims, and prompts instruct the model not to invent facts or outcomes.

Invoice PDF extraction is deliberately not an AI workflow. The PDF is read locally in the browser with `pdf.js`, deterministic parsing fills the editable invoice form, and the file itself is neither uploaded nor stored. An AI fallback should not be added until there is a documented temporary-upload, provider-retention, and deletion boundary.

Provider configuration is server-only: `ANTHROPIC_API_KEY`, optional `ANTHROPIC_BASE_URL`, `AI_ENRICHMENT_MODEL`, and `AI_SYNTHESIS_MODEL`. Keys are never exposed to the browser. Long free-text fields share a fixed request budget, supplied content is treated as untrusted data rather than model instructions, responses are schema-checked and bounded before they reach the UI, and responses are not stored as chat history. AI routes are rate-limited.

Before adding another AI workflow, document its input fields, exclude sensitive tables by default, produce a preview, require confirmation for writes, and add an own-only audit/notification record if the action has lasting impact.
