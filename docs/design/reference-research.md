# OwnDashboard reference research

Research date: 2026-07-22. References are used as pattern evidence, never as a source of code, copy, illustrations, brand claims, or wholesale layouts.

## Research method

The review targeted multi-area shells, dense operational views, triage, project workspaces, opportunity pipelines, finance/invoicing, settings, command surfaces, empty states, and mobile transformations. Refero was used for system-level token and surface analysis. Collect UI was used as a broad visual-pattern index; its strongest value was identifying common failure modes as well as useful state and layout archetypes. Authoritative product documentation was preferred for interaction behavior.

## Selected references

| Source and URL | Category / problem | Transferable principle for OwnDashboard | Do not copy | Adaptation, accessibility, and responsive implications |
| --- | --- | --- | --- | --- |
| Refero: [Linear design system](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1) | Dense product shell, border-led hierarchy, command surfaces | Compact type, a small radius vocabulary, hairline separation, and one restrained action accent let data carry the texture | Acid-lime palette, dark-only marketing treatment, team concepts, exact layout | Keep warm paper/graphite parity and cobalt structure; maintain AA borders/text; retain touch-size expansion on mobile |
| Refero: [Column design system](https://styles.refero.design/style/a76ec6ba-20b3-495c-9d89-1e58281e79e7) | Trustworthy technical finance | Deep ink structure, quiet near-white canvas, rare warm signal, mono only for identifiers/data | Banking marketing pages, seafoam data decoration, large editorial spacing | Apply trust register to Money and invoice UI; keep positive/negative meaning non-color and operational screens denser |
| Refero: [Jeton design system](https://styles.refero.design/style/1f32d914-6fdd-4692-b4fc-fcee2c414766) | Warm financial editorial language | Warm neutrals can make a serious finance product feel owned rather than institutional | Giant display type, rounded promotional panels, saturated orange dominance | Use warm paper only as canvas/surface nuance; never reduce ledger density or over-round controls |
| Linear docs: [Conceptual model](https://linear.app/docs/conceptual-model) | Connected entities, triage, shortcuts, contextual command actions | Repeated interaction grammar and clear relationships make a deep tool learnable | Teams, cycles, SaaS workspace hierarchy, naming, visual styling | Map repeated actions to owner workflows; keep `g` chords and command palette; expose shortcut help and focus semantics |
| Linear docs: [Display options](https://linear.app/docs/display-options) | List/board choice, grouping, ordering, visible properties | Views should alter presentation, not duplicate data; board is justified only when stage movement is central | Broad configurability and team defaults | Opportunities may support list/board; Inbox remains a triage list; persist only owner-level display preferences |
| Linear docs: [Project overview](https://linear.app/docs/project-overview) | Stable project context with related properties/resources | A consistent workspace header and property layer prevent tabs from feeling unrelated | Team leads, initiatives, progress prediction | Keep Overview/Tasks/Activity/Repository/Operations/Finance/Knowledge; show owned client, health, cost, revenue, dates, and attention before tab content |
| Stripe docs: [Use the invoicing dashboard](https://docs.stripe.com/invoicing/dashboard) | High-trust invoice creation and review | Draft → edit → explicit review/finalize, with totals and legal fields kept visible | Stripe billing concepts, payment automation, visual brand | Preserve Czech fields, VAT, QR, and explicit status consequences; mobile form groups stack without hiding totals |
| Stripe docs: [Manage invoices](https://docs.stripe.com/invoicing/dashboard/manage-invoices) | Dense invoice list and status-dependent actions | Status, filters, export, detail, duplicate, and destructive actions should be separated and conditional | Hosted invoice behavior and SaaS account hierarchy | Canonical invoice badges need labels/icons as well as color; destructive actions require consequence copy |
| Collect UI: [Monitoring dashboard](https://collectui.com/challenges/monitoring-dashboard) | Dashboard composition | Scan many alternatives for attention strips, ledger rows, compact filters, and chart framing | Decorative KPI walls, fake trends, giant donuts, glass panels | Home adopts an attention hierarchy; Money uses deterministic charts and tables only; every visual number comes from fixtures/data |
| Collect UI: [Project management](https://collectui.com/challenges/project-management) | Project rows, boards, detail panes | Compare row density, metadata placement, filters, and stage movement | Branded kanban clones and collaboration affordances | Project list prioritizes health/relationship/next action; Opportunities alone may use stage lanes; mobile becomes structured rows |
| Collect UI: [Inbox](https://collectui.com/challenges/inbox) and [Notifications](https://collectui.com/challenges/notifications) | Triage and action center | Source, time, status, selection, and action hierarchy should be visible in one scan | Email-client metaphors and unread alarm density | Distinguish capture from notification and pending from snoozed/processed/dismissed with labels plus markers; batch actions remain reversible where possible |
| Collect UI: [Invoice](https://collectui.com/challenges/invoice) | Invoice editor and paper layout | Separate app chrome from legal document; group parties, items, tax, totals, and actions | Decorative invoice templates and jurisdiction-agnostic fields | Keep existing A4 paper output fixed; refine only the surrounding app workflow and preserve print tests |
| Collect UI: [Settings](https://collectui.com/challenges/settings) | Long settings taxonomy | Persistent section navigation and clear integration state reduce search cost | Consumer profile settings, team administration, billing pages | Use Appearance, Navigation, Integrations, Notifications, AI & privacy, Data & export, Account; mobile uses stacked anchors |
| Collect UI: [Empty states](https://collectui.com/challenges/empty-states) | Initial vs filtered empty state | State copy must explain whether there is no data or merely no match and offer the right next action | Cartoon mascots, confetti, vague “nothing here” copy | Use quiet text/icon states now; reserve future operational-cartography illustration for Inbox, Opportunities, Projects, and Clients only |
| Collect UI: [Mobile menu](https://collectui.com/challenges/mobile-menu) | Small-screen information architecture | A short primary set plus a complete “More” destination is more usable than a horizontally scrolling sitemap | Hamburger-only hiding of core destinations and novelty transitions | Home, Inbox, Work, Projects, More form the stable bottom hierarchy; all remaining routes stay reachable in the More sheet |

## Patterns adopted

- Border and surface hierarchy before shadow hierarchy.
- One stable shell and repeated action grammar across mouse, keyboard, command palette, and touch.
- Attention-first Home and Work views instead of equal KPI galleries.
- Compact comparable rows and tables for projects, opportunities, clients, transactions, invoices, and references.
- Stage views only where movement is central; filtered list views remain the default for scanning.
- Stable project context, relationship breadcrumbs, tab continuity, and source-aware AI output.
- Settings taxonomy based on owner intent rather than implementation modules.
- Initial-empty and filtered-empty states with different copy and recovery actions.

## Patterns rejected

- Linear imitation, dark-only command-center styling, and borrowed accent colors.
- Stripe-like commercial account hierarchy or automated billing assumptions.
- Generic shadcn card grids, glassmorphism, giant metrics, gradients, neon, glow, and pills on ordinary controls.
- Team members, organization switchers, sales forecasting, public onboarding, pricing, testimonials, and SaaS claims.
- Generated dashboards, charts, invoices, labels, or fake product screenshots.
- Board views for Inbox, Money, Notes, or any area where comparison and trust matter more than stage movement.

## OwnDashboard synthesis

The references support a distinct direction rather than a composite clone: **calm operational intelligence for one professional**, expressed as **operational cartography**. Warm paper and graphite provide ownership and trust; deep ink/cobalt defines structure and selection; amber marks attention; entity relationships and line-based alignment create the map language. Authentic data, restrained density, localized status semantics, explicit consequences, and source-backed AI remain more important than decoration.
