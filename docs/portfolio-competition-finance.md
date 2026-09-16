# Portfolio, Works, Competition and development finance

Added on 2026-09-16. Migration: `20260916120000_portfolio_works_competition_finance.sql`.

## Portfolio registry

`src/lib/portfolio.ts` is the code-level list of the projects worked on every day. The
GitHub sync only materializes repositories on the saved allow-list, which is why a
repository created after the list was saved (`phone-app`) never reached the Projects
table. The registry is the second, deterministic source: every entry is materialized as
a `projects` row bound by `portfolio_key`, with or without GitHub, and the two BoardlessAI
ventures become child rows (`parent_id`) of the `quorum` repository project.

| Group | Entry | Repository |
| --- | --- | --- |
| OwnDashboard | OwnDashboard | `lukaskourilcz/own-dashboard` |
| Products | DNESKAi | `lukaskourilcz/aifirst` |
| Products | LINKA | `lukaskourilcz/phone-app` |
| Products | StudyShark + devShark | `lukaskourilcz/react-express-app` |
| BoardlessAI ventures | BoardlessAI | `lukaskourilcz/quorum` |
| BoardlessAI ventures | Design Lab | subsection of quorum |
| BoardlessAI ventures | GoVIRAL | subsection of quorum |

The Projects table renders these groups in this order. Any other active project stays in a
collapsed "Other active projects" group so nothing synced from GitHub disappears. The
`planPortfolioSync` and `planWorksSync` functions are pure; the Projects panel runs them in
an effect and writes only the rows that are missing or carry the wrong scope, key or
parent. Fixture previews never write.

`projects.scope` separates the portfolio (`project`) from client engagements (`work`);
rows that are neither are `other`. Subsections open the same `/projects/[slug]` workspace
as their parent.

## Works

`/works` lists `scope = 'work'` projects: client repositories such as `gym-plzen`,
`paris-claire` and `umyjemefasadu`. The add dialog offers the GitHub repository list (or a
typed `owner/name`) and an organization link. Inactive works stay visible, dimmed, because
a finished client project still carries invoices and knowledge. Opening a work keeps the
Works destination highlighted; the URL stays the canonical project workspace.

## Competition

`competitors` stores per-project research: name, website, summary, type (direct,
indirect, inspiration), most useful features, social-media content, pricing model, what
to learn from it, a 1–5 relevance score with rationale, social profiles, sources and a
review date. `/competition` groups every competitor by portfolio project; each project
workspace has a Competition tab with the same list and dialog. Own-only RLS with a
project ownership check.

## Links and ideas per project

The Links & Ideas workspace tab lists Library records whose `project_relevance` names the
project (short repository name, portfolio key or alias such as `design-lab`,
`goviral`), best usefulness score first. Editing stays in the Library.

## Development finance

The Money overview now shows development spend only. A subscription counts when its
group is Development or when it has at least one project allocation. A transaction
counts when it settles a subscription (`transactions.subscription_id`), is linked to a
project, or carries a development category. Personal spend never enters the figures.

`subscription_allocations` splits a shared subscription across projects by share; the
remainder is reported as unallocated instead of being guessed onto a project. A paid
invoice linked to a subscription inherits that subscription's split. Subscriptions also
record `started_on`, `ended_on`, `plan`, `vendor_url` and `notes`; `quarterly` joined the
billing cycles for Mobbin. The summary is computed in `src/lib/dev-finance.ts`:
recurring monthly and yearly totals, the Projects/Works/unallocated split, per-project and
per-vendor breakdowns, a twelve-month committed-versus-paid timeline and the recent
development payments.

The owner's live data was loaded on 2026-09-16 from vendor receipts in Gmail (Vercel,
Supabase, Anthropic, Apify, Canva, Foxy.ai, Mobbin, UptimeRobot, ElevenLabs, fal.ai,
OpenAI, Apple). Each imported transaction carries `external_id = gmail:<message id>` so a
re-import cannot duplicate it. Amounts inferred rather than read (the App Store Claude
Max months) are flagged in the subscription notes.

## Validation

Unit tests: `tests/lib/portfolio.test.ts` and `tests/lib/dev-finance.test.ts`, plus the
navigation, data-boundary and subscription tests. Browser tests: the dashboard section
walk includes Works and Competition, and the project workspace check includes the Links &
Ideas and Competition tabs.
