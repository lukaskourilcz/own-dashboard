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
typed `owner/name`) and an organization link. The typed field is not restricted to the
saved `visible_repo_ids`, so a client repository created after that allow-list was saved is
added here without touching Settings → Repositories; the allow-list only decides whether
the repository's own documents, tasks and commits are synced. Inactive works stay visible,
dimmed, because a finished client project still carries invoices and knowledge. Opening a
work keeps the Works destination highlighted; the URL stays the canonical project
workspace.

Every work already has a Competition tab in its workspace, and a work that has competitors
recorded is listed on `/competition` like any other project. What works do not get is an
empty Competition card on `/competition` when nothing is recorded, because the unfiltered
grouping only opens cards for `scope = 'project'` rows. Whether client engagements should
routinely carry the client's competitors is an open owner decision recorded in `NEEDED.md`,
not a structural limit — `competitors` RLS checks project ownership only.

## Competition

`competitors` stores per-project research: name, website, summary, type (direct,
indirect, inspiration), most useful features, social-media content, pricing model, what
to learn from it, a 1–5 relevance score with rationale, social profiles, sources and a
review date. `/competition` groups every competitor by portfolio project; each project
workspace has a Competition tab with the same list and dialog. Own-only RLS with a
project ownership check.

### Review freshness

Research ages, so `src/lib/competition.ts` reads `reviewed_at` against a 90-day marker
(`COMPETITOR_REVIEW_STALE_DAYS`). A review 90 days old or older is `stale`; a missing or
unreadable date is `never`, which is a different thing and gets its own label. Both states
show a text-labelled warning badge next to the competitor's type, so the cue is never
colour alone, and the review date itself now sits in the visible metadata row instead of
inside the collapsed Sources disclosure. A "Review" filter next to the project and type
filters narrows the list to the rows that need a refresh, and the toolbar and each card
header append the count when it is above zero.

Nothing expires and nothing is hidden: the marker is a reminder that a competitor's
pricing page and feature list may have moved since the note was written. Freshness is
computed from `useNow()` resolved once per panel and handed down as a prop — never per
row — and collapsed to the calendar day, because a 90-day boundary only moves at local
midnight. `reviewed_at` is a Postgres `date`, so it is compared through `daysUntilDate`,
which parses `yyyy-MM-dd` in local time rather than as UTC midnight.

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

### Confirmed amounts

**Implemented.** `subscriptions.amount_confirmed_on` (migration
`20260917120000_subscription_amount_confirmation.sql`) is the date the owner last compared
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
tests. `tests/lib/link-library.test.ts` covers the category merge. Browser tests: the dashboard section
walk includes Works and Competition, and the project workspace check includes the Links &
Ideas and Competition tabs.
