# Portfolio, Competition and development finance

Built on 2026-09-16 on the branch `claude/elegant-cori-h9cdgb` and merged into `main` on
2026-09-25. Migration: `20260916094243_portfolio_works_competition_finance.sql`, applied to
production on 2026-09-16 under that version.

## Portfolio registry

`src/lib/portfolio.ts` is the code-level list of the projects worked on every day. The
GitHub sync only materializes repositories on the saved allow-list, which is why a
repository created after the list was saved (`phone-app`) never reached the Projects
table. The registry is the second, deterministic source: every entry is materialized as
a `projects` row bound by `portfolio_key`, with or without GitHub, and the two boardlessAI
ventures become child rows (`parent_id`) of the boardlessAI repository project.

| Group | Entry | Key | Repository |
| --- | --- | --- | --- |
| OwnDashboard | OwnDashboard | `own-dashboard` | `lukaskourilcz/own-dashboard` |
| Products | DNESKAi | `aifirst` | `lukaskourilcz/aifirst` |
| Products | LINKA | `phone-app` | `lukaskourilcz/phone-app` |
| Products | devShark | `react-express-app` | `lukaskourilcz/react-express-app` |
| boardlessAI ventures | boardlessAI | `quorum` | `lukaskourilcz/quorum` |
| boardlessAI ventures | Design Lab | `quorum-design-lab` | subsection of boardlessAI |
| boardlessAI ventures | GoVIRAL | `quorum-goviral` | subsection of boardlessAI |

The keys are the values stored in `projects.portfolio_key` and never change. The names and
slugs are the ones #76 introduced; the registry uses them only when it creates a missing
row. A row is found by its key, or by its current or an earlier repository name
(`previous_repo_full_names`), so a GitHub rename does not create a duplicate.

`planPortfolioSync` is pure. The Projects panel runs it in an effect once the project list
has loaded and writes only what is missing: a row for an entry that has none, the
`portfolio_key` of a row found by repository, and the `parent_id` of a subsection. It never
changes a name, a slug or the engagement. Fixture previews never write.

The Projects table keeps the kickoff layout: the owner's own projects, then a "Freelance —
hired" divider and the client projects (`projects.engagement`). A subsection is listed under
its parent without a drag handle and opens its own `/projects/[slug]` workspace. Competition
groups its cards by the registry categories above.

### Client work

The branch first tracked client repositories as a separate Works section driven by
`projects.scope` (`project`, `work` or `other`). The 2026-09-25 kickoff solved the same need
with `projects.engagement` and the divider, so the merge kept one field:
`20260925200100_project_engagement_replaces_scope.sql` drops `scope`, `/works` redirects to
`/projects`, and the project form sets both the engagement and, for a client project, the
client organization. Whether a project is part of the daily portfolio is `portfolio_key`.
On production, `umyjemefasadu` was `work` on the branch and `own` after the kickoff; it
stays `own` until the owner changes it (`NEEDED.md`).

A client project has a Competition tab in its workspace and is listed on `/competition` once
it has competitors recorded. It does not get an empty card there when nothing is recorded;
whether client projects should routinely carry the client's competitors is an open owner
decision in `NEEDED.md`, not a structural limit, because `competitors` RLS checks project
ownership only.

## Competition

`competitors` stores per-project research: name, website, summary, type (direct,
indirect, inspiration), most useful features, social-media content, pricing model, what
to learn from it, a 1–5 relevance score with rationale, social profiles, sources and a
review date. `/competition` groups every competitor by portfolio project; each project
workspace has a Competition tab with the same list and dialog, and Settings can hide that
tab (`20260925200200_project_competition_tab.sql`). Own-only RLS with a project ownership
check.

### Review freshness

Research ages, so `src/lib/competition.ts` reads `reviewed_at` against a 90-day marker
(`COMPETITOR_REVIEW_STALE_DAYS`). A review 90 days old or older is `stale`; a missing or
unreadable date is `never`, which is a different thing and gets its own label. Both states
show a text-labelled warning badge next to the competitor's type, so the cue is never
colour alone, and the review date itself sits in the visible metadata row instead of
inside the collapsed Sources disclosure. A "Review" filter next to the project and type
filters narrows the list to the rows that need a refresh, and the toolbar and each card
header append the count when it is above zero.

Nothing expires and nothing is hidden: the marker is a reminder that a competitor's
pricing page and feature list may have moved since the note was written. Freshness is
computed from `useNow()` resolved once per panel and handed down as a prop — never per
row — and collapsed to the calendar day, because a 90-day boundary only moves at local
midnight. `reviewed_at` is a Postgres `date`, so it is compared through `daysUntilDate`,
which parses `yyyy-MM-dd` in local time rather than as UTC midnight.

## Links per project

The branch listed a project's Library records through the free-text
`ai_links.project_relevance`. `main` replaced that with `project_links` (#78): the workspace
Overview lists the links a project really uses, each with a role and a note, and
`project_relevance` is deprecated. The branch's Links & Ideas tab was not merged.

## Development finance

The Money overview shows development spend only. A subscription counts when its
group is Development or when it has at least one project allocation. A transaction
counts when it settles a subscription (`transactions.subscription_id`), is linked to a
project, or carries a development category. Personal spend never enters the figures.

`subscription_allocations` splits a shared subscription across projects by share; the
remainder is reported as unallocated instead of being guessed onto a project. A paid
invoice linked to a subscription inherits that subscription's split. Subscriptions also
record `started_on`, `ended_on`, `plan`, `vendor_url` and `notes`; `quarterly` joined the
billing cycles for Mobbin. The summary is computed in `src/lib/dev-finance.ts`:
recurring monthly and yearly totals, the split between own projects, client projects
(`projects.engagement`) and unallocated overhead, per-project and per-vendor breakdowns, a
twelve-month committed-versus-paid timeline and the recent development payments. The
per-project table lists every portfolio and client project, and any other project once it
carries spend.

The owner's live data was loaded on 2026-09-16 from vendor receipts in Gmail (Vercel,
Supabase, Anthropic, Apify, Canva, Foxy.ai, Mobbin, UptimeRobot, ElevenLabs, fal.ai,
OpenAI, Apple). Each imported transaction carries `external_id = gmail:<message id>` so a
re-import cannot duplicate it. Amounts inferred rather than read (the App Store Claude
Max months) are flagged in the subscription notes.

### Confirmed amounts

**Implemented.** `subscriptions.amount_confirmed_on` (migration
`20260916125708_subscription_amount_confirmation.sql`) is the date the owner last compared
a subscription's amount, currency and billing cycle with the vendor's own invoice. Null
means nobody has compared them, which is where every row starts — the column is not
back-filled, because only the owner knows which figures they have checked.

The confirmation covers one figure. `amountConfirmationAfterEdit` in
`src/lib/dev-finance.ts` clears it whenever the amount, currency or billing cycle changes,
so a date can never vouch for a number it was not given for. Renaming a vendor or editing
its notes leaves it standing, and a newly created subscription is never born confirmed.

The reader shows this twice. Money → Development finance sums the running development
subscriptions with no confirmation into `unconfirmedMonthly`/`unconfirmedCount`, printed
under the recurring total and explained above the by-vendor table; the same table prints
each subscription's note under the vendor name, so a caveat the import recorded is read
where the amount is read. Subscriptions carries the control: the check icon on a row
stamps today's date or clears it, and the editor warns before a figure change retires a
confirmation. An ended subscription is left out of the figure — its amount no longer moves
the recurring total.

## Validation

Unit tests: `tests/lib/portfolio.test.ts`, `tests/lib/competition.test.ts` and
`tests/lib/dev-finance.test.ts`, plus the navigation, data-boundary and subscription
tests. `tests/lib/link-library.test.ts` covers the category merge, and
`tests/lib/migration-contracts.test.ts` covers the 2026-09-25 integration migrations.
Browser tests: the dashboard section walk includes Competition, and the project workspace
check includes the Competition tab.
