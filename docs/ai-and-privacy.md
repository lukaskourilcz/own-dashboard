# AI and privacy

OwnDashboard uses AI only inside a visible workflow.

## Current AI actions

- Quick add classifies one short user-entered line as a task, calendar proposal, or inbox capture.
- Link enrichment proposes a short description, category, and pricing label from a URL the user submitted.
- Project Copilot produces facts, risks, suggestions, and record identifiers from one owned project's bounded context.
- Weekly operating brief produces the same structured sections from a bounded professional snapshot and places them in an editable review draft.

There is no global assistant with implicit access to the full database.

## Write controls

- Model output from quick add is returned as a proposed structured action.
- A proposed task or inbox write requires explicit confirmation.
- A calendar proposal opens the existing form and is not auto-created.
- Link enrichment fills an existing form; the user still saves it.
- Opportunity-to-project conversion is deterministic, not AI-driven, and requires confirmation.
- Project and weekly briefs require explicit consent before the request. They do not write database rows.
- A generated weekly brief is not saved or completed until the user chooses the separate review action.

## Data boundaries

AI can be disabled in Settings. Sensitive context is a separate preference and defaults off. Quick add sends only the line the user entered, the date, and the browser timezone. It does not attach financial rows, notes, emails, or project history.

Project Copilot always includes a bounded set of project identity, tasks, costs, automations, opportunities, and dates. It includes note text and invoice metadata only when sensitive-context opt-in is on. The weekly brief is itself a sensitive multi-domain operation and is unavailable until that opt-in is on. Queries are explicitly scoped by authenticated `user_id` and project id, source identifiers are derived from returned rows rather than model claims, and prompts instruct the model not to invent facts or outcomes.

Provider configuration is server-only: `ANTHROPIC_API_KEY`, optional `ANTHROPIC_BASE_URL`, `AI_INTENT_MODEL`, `AI_ENRICHMENT_MODEL`, and `AI_SYNTHESIS_MODEL`. Keys are never exposed to the browser. Responses are schema-checked and bounded before they reach the UI, and are not stored as chat history. AI routes are rate-limited.

Before adding another AI workflow, document its input fields, exclude sensitive tables by default, produce a preview, require confirmation for writes, and add an own-only audit/notification record if the action has lasting impact.
