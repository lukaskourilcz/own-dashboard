# OwnDashboard design system

This document defines production rules. `src/app/globals.css` is the token source; shared primitives live in `src/components/ui`; domain behavior stays in existing panels and libraries.

## Token architecture

Surface tokens: background, primary surface, secondary band, muted surface, inset surface, hover, selected, elevated, overlay, and skeleton. Content tokens: foreground, muted, subtle. Structure tokens: border, strong border, brand, brand-soft, primary action, focus. Semantic tokens: information, success, warning, risk, destructive and corresponding soft surfaces. Data tokens: five deterministic chart series. AI tokens: fact, risk, suggestion, evidence.

Never introduce a raw hex or framework color utility in a production component when a semantic token exists. Fixed invoice paper colors, QR output, and third-party brand marks are explicit exceptions.

## Typography roles

| Role | Implementation intent |
| --- | --- |
| Login/display | 28–40 px, compact leading, only on the private auth surface |
| Page title | 22 px desktop, 20 px narrow, semibold, tight tracking |
| Section/module title | 12–16 px, sentence case, semibold |
| Body | 14 px / 1.5 |
| Small body and metadata | 11–13 px with AA contrast |
| Numeric metric | 20–28 px, tabular |
| Technical value | Geist Mono, 11–13 px |
| Table/row | 12–14 px, dense but readable |
| Empty state | short 14 px title and 12 px explanation |
| AI answer | 14 px, bounded reading width |
| Evidence source | 11–12 px, inspectable and wrap-safe |

Do not uppercase long labels. Czech diacritics must be tested in every font role.

## Layout and density

The maximum operational frame is 90 rem; reading/editor surfaces use 72 rem or less. Desktop sidebar is 15.5 rem and collapsed rail 4.25 rem. Dense rows are 40 px desktop; ordinary rows are 46 px. Touch versions preserve at least 44 px targets. Page padding is 16 px narrow, 24–32 px desktop. Workspace tabs scroll on narrow screens. Detail panes stack below 1024 px. Mobile fixed elements include safe-area insets.

Home and login may breathe. Work, Projects, Opportunities, Career, Money, and Invoices use medium-high density. Prefer section bands, aligned rows, split panes, and tables. Use cards only for summaries, self-contained objects, and elevated workflows. Avoid nested cards.

## Components

- `PageHeader` supports regular and compact density plus an optional contextual eyebrow.
- `Card` is a flat contained module; it no longer implies elevation.
- `Button`, fields, selects, dialogs, tooltips, toasts, and empty states retain their single shared implementations.
- `StatusBadge` is the canonical label/marker/tone presentation for shared project, opportunity, organization, inbox, invoice, and health states.
- `EntityBadge` shows relationships without pretending they are statuses.
- `Metric` creates compact border-led measures instead of repeating equal cards.
- `AiProposalPanel` and `AiResultGroup` distinguish facts, risks, suggestions, and evidence without sparkles, gradients, bot mascots, or implied writes.
- `BrandMark` is the name-independent shell/auth/icon placement contract.

New generic abstractions require two real consumers. Search before creating. Existing invoice, Career, finance, editor, and repository components retain domain logic while adopting shared surface and status primitives incrementally.

## Status rules

`src/lib/status-presentation.ts` owns shared localized labels and semantic tone. A badge includes a non-color marker and text. Unknown values receive a readable fallback for resilience, but supported production enums must be added in English and Czech. Never render `proposal_sent`, `prospective_client`, `on_hold`, `at_risk`, or similar internal values directly.

## Tables, rows, and cards

Transactions, invoices, listings, projects, references, and other comparable entities are rows/tables. Activity and notifications are chronological rows. Opportunities may use a board only when stage movement is the action; a dense list remains available. Cards summarize, contain a focused object, or elevate a workflow. A card inside a card is normally a signal to use a section line or inset band.

## Responsive transformations

- Mobile primary navigation is Home, Inbox, Work, Projects, More. More must expose all visible owner destinations and Settings.
- Tables become structured rows when comparison remains clear; legal/financial column sets may scroll with a visible affordance and sticky labels.
- Filters wrap or stack; no control becomes hover-only.
- Project workspace tabs remain horizontally scrollable with an obvious active state.
- Split panes and form grids stack; dialogs become near-full-width with safe margins.
- Long Czech labels, project/client names, currency values, and AI text wrap without displacing actions.
- Deferred login media has desktop and mobile placement hooks; absence of media must not leave a broken frame.

## Accessibility

Target WCAG 2.2 AA. Preserve visible focus, logical focus order, Radix focus traps, Escape behavior, labels/error associations, semantic headings/landmarks/tables, reduced motion, zoom/reflow, touch targets, and non-color statuses. Loading and generation need names or live status. Decorative media uses empty alt/hidden semantics; explanatory media needs localized alternatives. Never put essential copy in an image.

## UX writing and states

State the count, condition, consequence, and next action. Initial-empty and filtered-empty are different states. Also cover loading, error, offline/unavailable integration, reauthorization, disabled, permission failure, success, destructive confirmation, missing relationship, archived, long content, mobile, and reduced motion. AI proposals always state data scope, limitations, sources, and that nothing is saved until a separate action.

## Anti-AI-slop review

Reject gradients used as default decoration, glows, glass, giant display type, decorative metrics, pill controls without tag/status semantics, excessive card grids, random shadows/radii, fake charts, generic “insight” copy, filler images, AI robots/brains/sparkles, and generated UI. Character comes from connected information, authentic domain data, purposeful density, relationships, typographic precision, and restrained operational-cartography cues.
