# App-wide review — 23 October 2026

Status: in progress. This report does not claim release completion.

The owner requested a second review of every OwnDashboard page, fixes for verified issues, lower operating cost, updated documentation, meaningful commits and a merge into main. Work continues in the isolated audit checkout; the owner's unrelated checkout remains intact. The baseline is `dba5fc8`, including the completed DNESKAi audit implementation. Historical reports retain their original evidence dates.

## Review order and coverage

Each destination needs source/data-flow review, relevant business and failure checks, and rendered verification. An inventory entry alone is not a review. `source-inventory.json` records the baseline source files and their review status.

| Area | Destinations | State |
| --- | --- | --- |
| Shared boundaries | Authenticated catch-all, shell, navigation, query cache, initial loading | Reviewing |
| Execution | Home, Work, Inbox, Tasks, Calendar, Goals, Dates | Pending |
| Projects and clients | Projects list and all workspace tabs, Competition, Clients, Opportunities | Pending |
| Career | Board, saved roles, applications, history, letters | Pending |
| Finance | Money, Accounts, Transactions, Categories, Subscriptions, Invoices and print | Pending |
| Knowledge | Notes, Prompts, Tools, Links, IG TIPS, References | Pending |
| Marketing | Review, calendar, knowledge, results, Workflows, DNESKAi workspace | Pending |
| Account and public boundaries | Settings, Login, Guest, unknown routes, dev-preview guard, OAuth, PWA | Pending |
| Backend and operations | API routes, cron/provider budgets, database ownership and query plans | Reviewing |
| Release | Current-doc reconciliation, full validation, additive migrations, PR, main merge, deployment | Pending |

## Findings under review

1. Fixed: failed server reads now render a bilingual retry state before mounting the shell. A successful missing-project read still returns 404; an outage does not. In-shell navigation also waits for all required entity stores before mounting writable panels. Verified cached records remain available during background failures.
2. Fixed: both on-demand destinations reject partial read failures. Opportunities surfaces the failure and no longer records a failed platform-directory request as a successful zero-platform check.
3. Fixed: sidebar projection fallback now checks whether projects were actually loaded, so a loaded empty list stays empty. Destinations already loading projects reuse that read for navigation rather than making a duplicate query.
4. Every destination panel is statically imported by the persistent shell. Measure the initial script payload, then defer unused destination code while preserving SSR and shell state.
5. Fixed: Marketing no longer loads three unused shell entity families; Notes loads only notes and projects. Component dependencies and route-contract tests confirm the smaller boundary.

Targeted validation for these shared changes: 19 tests passed across server-page, route-data and real query-cache/retry component tests; TypeScript and targeted ESLint passed. Full release and rendered checks remain pending.

## Database evidence

Read-only production advisors were inspected for the `own-dashboard` EU project. Findings need catalog verification before changes: 73 RLS init-plan warnings, 70 unindexed foreign keys, 36 unused indexes, one duplicate-index warning, 15 executable security-definer function warnings and nine intentionally private tables without browser policies. Advisor warnings alone do not justify extra indexes, index deletion or wider grants. No secret rows or credential values were read.

## Release evidence

No new app-wide release checks have run yet. Previous DNESKAi validation is recorded separately in `../dneskai-audit-implementation-2026-10-23.md` and is not evidence for subsequent changes. The additive `20261023135551_dneskai_engagement_receipts.sql` migration must be applied before the main merge deploys its RPC caller.
