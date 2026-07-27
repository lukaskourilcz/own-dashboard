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

At `md` and above, the application sits inside a graphite desktop with 20 px block padding and 30 px inline padding. The window fills that padded area at every width, so the graphite margin stays 20 px top and bottom and 30 px left and right rather than widening past a fixed maximum. The window is viewport-contained, 12 px rounded, and scrolls only its content region. Desktop sidebar is 224 px and the collapsed rail 64 px; the shared toolbar is 52 px. Content padding is 16 px narrow and 20–24 px desktop. Dense rows are 38 px desktop; ordinary rows are 46 px. Touch versions preserve at least 44 px targets. Workspace tabs scroll on narrow screens. Detail panes stack below 1024 px. Mobile removes desktop wallpaper/window framing and includes safe-area insets.

Home and login may breathe. Work, Projects, Opportunities, Career, Money, and Invoices use medium-high density. Prefer section bands, aligned rows, split panes, and tables. Use cards only for summaries, self-contained objects, and elevated workflows. Avoid nested cards.

## Components

- `PageHeader` supports regular and compact density plus an optional contextual eyebrow.
- `Card` is a compact white contained module with a hairline border, 12 px radius, 16–18 px padding, and one restrained surface shadow.
- `Button`, fields, selects, dialogs, tooltips, toasts, and empty states retain their single shared implementations.
- `ConfirmationProvider` and `useConfirmation` are the only destructive-confirmation surface. Deletions use the branded Radix dialog with a named consequence and explicit destructive action; browser-native confirmation dialogs are reserved for non-destructive consent until migrated.
- `StatusBadge` is the canonical label/marker/tone presentation for shared project, opportunity, organization, inbox, invoice, and health states.
- `EntityBadge` shows relationships without pretending they are statuses.
- `Metric` creates compact border-led measures instead of repeating equal cards.
- `AiProposalPanel` and `AiResultGroup` distinguish facts, risks, suggestions, and evidence without sparkles, gradients, bot mascots, or implied writes.
- `BrandMark` is the name-independent shell/auth/icon placement contract.
- `DailyFocusPanel` is an operational execution surface: it snapshots at most seven active-project or GLOBAL tasks, exposes waiting age, and uses the 49-day completion garden as professional task history rather than lifestyle gamification.

New generic abstractions require two real consumers. Search before creating. Existing invoice, Career, finance, editor, and repository components retain domain logic while adopting shared surface and status primitives incrementally.

## Status rules

`src/lib/status-presentation.ts` owns shared localized labels and semantic tone. A badge includes a non-color marker and text. Unknown values receive a readable fallback for resilience, but supported production enums must be added in English and Czech. Never render `proposal_sent`, `prospective_client`, `on_hold`, `at_risk`, or similar internal values directly.

## Tables, rows, and cards

Transactions, invoices, listings, projects, references, and other comparable entities are rows/tables. Desktop data text is 12–12.5 px and primary tables are sized to fit the 13-inch window content area before horizontal scrolling. Activity and notifications are chronological rows. Opportunities may use a board only when stage movement is the action; a dense list remains available. Static summary cards in one row share height. Dynamic category collections use masonry columns with `break-inside: avoid`. Task titles wrap to at most three lines. Cards summarize, contain a focused object, or elevate a workflow. A card inside a card is normally a signal to use a section line or inset band.

Sortable containers expose one dedicated drag handle. Attach dnd-kit activator listeners and `touch-action: none` only to that handle; keep row/card text selectable and leave ordinary links and actions outside the drag target.

Unequal Library groups use masonry-style CSS columns with `break-inside: avoid`; do not use a row-aligned grid that reserves the tallest category's height across every column.

## Responsive transformations

- Mobile primary navigation is Home, Inbox, Work, Projects, More. More must expose all visible owner destinations and Settings.
- Tables become structured rows when comparison remains clear; wide operational, legal, or financial column sets may scroll inside a width-contained region without creating document-level overflow.
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
