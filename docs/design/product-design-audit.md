# OwnDashboard product design audit

Status: authoritative baseline for the July 2026 design overhaul. Repository code remains the source of truth for behavior.

## Product and audience

OwnDashboard is a private, bilingual, self-hosted operating system for one technically capable professional. It joins delivery, client acquisition, organizations, Career, invoices, costs, banking, planning, and reusable knowledge without pretending to be a team SaaS, CRM, accounting suite, or lifestyle tracker. The high-frequency loop is Home → capture → Inbox triage → canonical record. The other defining loops are opportunity → organization → project → invoice; project → tasks/repository/operations/finance/knowledge; and listing → evidence-grounded application.

Implementation follow-up (2026-07-22): Career now uses a sortable comparable table; Projects uses a sortable portfolio table with dedicated drag handles and per-project communication/development context; subscription views expose renewal countdown, operational group, and importance; and Agents provides an explicit own-only VPS task queue rather than a remote terminal. These changes resolve the specific listing/project/card-density findings below without weakening the existing workflow boundaries.

The product must answer what needs attention, why, which records are connected, and what action is safe to take next. Trust is most sensitive in invoice math and print, bank data, destructive actions, opportunity conversion, exports, integration credentials, RLS, and any AI workflow that reads private context.

## Architecture that design work must preserve

- `src/app/[[...slug]]/page.tsx` is the authenticated server boundary. It validates routes, resolves owned project workspaces, seeds only data required for the initial destination, and preserves bounded query limits.
- `src/components/dashboard-shell.tsx` is the persistent client shell. Its History API navigation, back/forward handling, shared navigation model, lazy React Query fetchers, centralized keys, and `useEntityStore` compatibility are deliberate.
- `/projects/[id-or-slug]` is the only supported nested dashboard route. Unknown and cross-user project identifiers remain 404.
- Supabase own-only RLS, related-record ownership checks, explicit Data API grants, service-role isolation, and the `SECURITY INVOKER` opportunity-conversion RPC are non-negotiable.
- Static FX, Czech VAT calculations, QR Platba, PDF import review, A4 print isolation, Google Calendar as the direct event source, and explicit AI consent/evidence validation are business behavior, not styling details.

## Journey assessment

| Journey | Current strength | Friction or risk | Design response |
| --- | --- | --- | --- |
| Daily operating | Real calendar, tasks, attention, Quick Add, configurable widgets | Equal-weight modules weaken the attention hierarchy | Lead with today and attention; demote passive totals; keep capture always reachable |
| Inbox triage | Search/filter/status controls, notifications, deliberate Process action | Dense controls do not clearly distinguish source, destination, and lifecycle; processing spans client mutations | Make the non-atomic boundary explicit; use row hierarchy and state markers; preserve confirmation and query invalidation |
| Work review | Explainable health and editable weekly review exist | Six equal metric cards and a single textarea flatten facts, risks, decisions, priorities, and follow-ups | Use an attention band, compact metrics, and structured editable review sections |
| Projects | Canonical entity, ordering, GitHub and finance depth, scoped workspace | List and workspace use many repeated cards; status and relationships are visually weak | Use dense rows, relationship metadata, health signals, and one stable workspace header |
| Opportunities | Correct Tugedr semantics and atomic conversion RPC | Raw enum labels, card grid, weak follow-up urgency, `prompt`/`confirm` conversion UI | Canonical localized statuses/sources, compact pipeline rows, explicit conversion review |
| Clients | Related totals and records are already derived | Card-only grid, raw organization enums, no focused relationship surface | Searchable relationship list with expandable/detail treatment; do not grow into CRM |
| Career | Mature listing/application/evidence logic | Large monolithic surface and uneven visual separation | Reinforce listing, shortlist, application, draft, evidence, and gap layers without changing truth rules |
| Money and invoices | Deterministic finance model and mature Czech invoice workflow | Dense functionality shares generic card language; some raw color utilities bypass tokens | Ledger-first rows and tables; semantic status; keep legal paper output fixed |
| Planning and Library | Broad mature functionality with project relationships | Local patterns vary across large panels; long content and mobile density vary | Shared headers, filters, rows, values, system states, and relationship cues |
| Settings | Real integration/privacy/export controls | Long single panel lacks a clear settings taxonomy | Appearance, Navigation, Integrations, Notifications, AI & privacy, Data & export, Account |
| Contextual AI | Bounded sources, strict parsing, validated citations, separate writes | Some output is rendered as ordinary cards or merged into plain text | A subordinate AI proposal language with facts, risks, suggestions, sources, limitations, and consent |

## Visual audit

### Strengths to retain

- Geist Sans/Mono, compact hierarchy, tabular financial/date/count figures, one Lucide icon family, restrained shadows, light/dark parity, visible focus rings, reduced-motion handling, Radix primitives, and BlockNote token integration.
- The neutral stone/graphite baseline is professional and already avoids neon, glassmorphism, and saturated finance surfaces.
- The catch-all shell preserves context well; `/dev-preview` provides authentic deterministic UI instead of fake screenshots.
- Page headers, cards, buttons, fields, selects, dialogs, tooltips, toasts, and empty states already form a usable shared base.

### Debt and inconsistencies

- Brand identity is still generic: `Activity` is used as the app mark, selected navigation uses a neutral fill, and the login mesh reads as a starter aesthetic rather than a private professional system.
- Mobile navigation exposes nearly every destination in one horizontal strip. It is technically complete but not a deliberate small-screen hierarchy.
- Many operational screens overuse equal cards. Work overview is the clearest example; clients and opportunities also lack comparable row/table scanning.
- Internal enums leak through `replaceAll("_", " ")` or literal option labels in Work, Clients, Opportunities, project activity/finance, and some large panels. This breaks Czech parity and semantic consistency.
- Status implementations compete: invoice-specific badge code, project-health text, ad hoc opportunity/organization labels, job-local mappings, and colored plan utilities.
- The surface vocabulary lacks selected, inset, elevated, information, risk, focus, skeleton, chart, integration, and AI-specific semantic tokens.
- `PageHeader` gives every destination the same visual rhythm. High-attention, trust-sensitive, workspace, and editor surfaces need controlled variants, not unrelated one-offs.
- Some important controls have 28–36 px targets. Compact desktop density is good, but touch presentations need 44 px hit areas or equivalent padding.
- Dialog close copy is hard-coded in English. Toast placement and mobile fixed navigation need safe-area treatment.

## Accessibility and responsive audit

Current strengths include Radix focus management, `focus-visible` styling, semantic tables in mature panels, reduced-motion CSS plus `MotionConfig`, and axe coverage. Gaps include hard-coded English accessible names, ambiguous icon-only destructive actions, status communicated mainly by color in places, horizontal mobile navigation overload, table overflow risk, insufficient touch target height, and a lack of explicit live-region behavior for long AI generation/loading states.

Responsive hotspots are the opportunity/client grids, project workspace tabs, financial and invoice tables/forms, Career panes, calendar split view, BlockNote chrome, settings sections, dialog width, and long Czech labels. Desktop hover-only secondary actions must always retain a touch path. Tables should become structured rows when comparison survives; only genuinely wide financial/legal tables should scroll.

## Reuse and consolidation map

Reuse `PageHeader`, `SectionLabel`, `Card`, `Button`, `Input`, `Textarea`, `SimpleSelect`, Radix `Dialog`, `Tooltip`, `Toast`, and `EmptyState`. Extend rather than replace them. Add focused operational primitives only where multiple production consumers exist: `StatusBadge`, `EntityBadge`/relationship link, compact metrics, structured rows/data table, and AI proposal/evidence panels. Keep invoice status semantics compatible with the existing invoice component while moving shared tone rules to the canonical status layer.

Large panels contain valuable business logic and should be migrated incrementally rather than rewritten: Projects, Career, Notes, Tasks, Finance, Subscriptions, and References. Their mutations, filters, imports, calculations, and scoping are higher risk than their markup.

## State and copy priorities

Every production area needs distinct initial-empty, filtered-empty, loading/unavailable, error, disabled, disconnected/reauthorize, archived, missing-relationship, and destructive-confirmation states. Copy should state a count, condition, consequence, or next action. Avoid “unlock,” “supercharge,” “smart,” and generic “insight” language. Tugedr is always an opportunity source. Removed Pulse, moods, habits, streaks, books, couples, and lifestyle tracking stay inaccessible.

## Generated-media boundary

Higgsfield connected during the follow-up production pass, but its billing status reported zero usable MCP trial credits and every generation request produced an error. A future pass must research at least three current low-cost or free alternatives and may use a documented provider with acceptable rights, privacy, watermark, format, and quality behavior. High-value uses remain a name-independent mark exploration, login desktop/mobile artwork, four restrained empty-state illustrations, and an authentic `/dev-preview`-based repository/Open Graph composition. Generated media remains harmful in financial tables, charts, invoice paper output, repository/bank UI, notes editing, dense screens, or any representation of real records. No filler, unreviewed output, or fake UI may ship.

## Baseline validation record

On 2026-07-22, Vitest completed with 24 files and 236 tests passing. Initial ESLint and TypeScript processes produced no diagnostics but did not terminate after several minutes and were interrupted; the initial production build reached “Creating an optimized production build” but likewise did not complete before interruption. These are environment-duration baselines, not passing claims, and the final validation pass must rerun them separately.
