# Handoff — issues #64 to #73

**Status 2026-09-25:** merged into `main` together with the kickoff (#75–#83). The
merge kept `projects.engagement` and dropped `projects.scope`, folded the Works section
into Projects behind the freelance divider, dropped the Links & Ideas workspace tab in
favour of `project_links`, renamed the migration files to the versions production
recorded, and fixed the parent check in the `projects` policies. The `schema.sql`
question below was settled by #85. The #73 captures were taken (`0aae79a`, retaken
after the merge as `media/changelog/2026-09-25-*.png`) and the release entry is in
`src/lib/changelog.ts` and `CHANGELOG.md` (`7a26c47`, then the 2026-09-25 entry).
The table under "Per issue" is the state on 2026-09-16, with #73 updated.

Written at the end of the session of 2026-09-16. Branch: `claude/elegant-cori-h9cdgb`.
Every issue below has a long comment on GitHub with the file-level detail; this
file is the index and the short version.

## What landed

Seven commits, all on the branch above:

| Commit | Issues | Subject |
| --- | --- | --- |
| `93f25d5` | #65, #67 | Staged transaction rules; invoice payment matching by variable symbol |
| `267f941` | #68 | ARES fill and VIES VAT verification |
| `00d472e` | #71, #72, #73 | Competitor review freshness, category merge, confirmed amounts, generated changelog |
| `4e9ac4d` | #64 | Bank provider abstraction (GoCardless, Fio, Enable Banking) |
| `96e0b43` | #70 | Cron heartbeats and the Uptime Kuma receiver |
| `0a24d2a` | #66 | Weekly review folded into a five-step planning flow |
| `79db46d` | #69 | Career stage board, structured contacts, follow-ups outside Career |

## The migrations are applied

All seven were run against the live project and verified through
`information_schema`, so no issue is waiting on a database step:

- `20260916125652_organization_registry_verification` — six columns on `organizations`
- `20260916125742_transaction_rules` — table, four own-only policies, touch trigger, guarded backfill
- `20260916125718_invoice_payment_matching` — three columns and two partial indexes on `transactions`
- `20260916125708_subscription_amount_confirmation` — `subscriptions.amount_confirmed_on`
- `20260916135326_cron_heartbeats` — two columns and two partial indexes on `crons`
- `20260916141837_bank_provider_abstraction` — `bank_connections` reshaped, `bank_provider_credentials` created
- `20260916141348_job_application_contacts` — two columns on `job_applications`

## Validation

`npx tsc --noEmit` exit 0, `npm run lint` exit 0, `npm run test` 45 files /
505 tests passed, `npm run build` exit 0. The Playwright suite was started on
the final tree; see the session summary for its result.

## One inconsistency to settle deliberately

`supabase/schema.sql` and `supabase/migrations/` now disagree. The #67 lane
appended its table to `schema.sql`; the #64, #68 and #70 lanes deliberately did
not, because `schema.sql` is a pre-professional historic baseline that contains
no `organizations` table at all — an `ALTER` there would abort a fresh install
before the migration that creates the table ever ran. So the baseline is now a
historic snapshot plus one newer table, which is the worst of both.

Pick one: either consolidate every post-`20260721` migration into the baseline,
or stop mirroring into it and remove the block the #67 lane added. Do not leave
it as it is — a fresh install currently needs both files and neither is complete.

## Per issue

| Issue | State | What is actually left |
| --- | --- | --- |
| #64 | partial | Fio's HTTP path has never run; Enable Banking's request flow is unimplemented behind a typed error. Both need credentials. GoCardless is closed to new signups, so which provider to depend on is a decision worth making before the current consent lapses. |
| #65 | done | Cron cadence: the issue asks hourly, Vercel Hobby allows daily. A plan decision, one line in `vercel.json`. |
| #66 | done | Run one real week and check the unmatched count before trusting the percentages. |
| #67 | done | Review the backfilled rules before a full apply; decide when `transaction_category_rules` can be dropped. |
| #68 | partial | What a verified VAT id should do to an invoice is a tax decision, not a code one. `src/lib/invoices.ts` was left alone on purpose. |
| #69 | partial | The board and contacts ship. The monthly AI budget has no subject: commit `5d32e6b` removed every LLM feature, so there is nothing whose cost a cap would bound. |
| #70 | partial | Cron heartbeats ship. The VPS agent-task half has no feature to attach to — the agents panel was removed in `5d32e6b` and only an orphaned table survives. Needs Uptime Kuma self-hosted before any of it monitors anything. |
| #71 | open | The eight verification checks are yours: they live in vendor consoles and Apple invoice PDFs, not in this repository. The confirmation surface is how you work the list. |
| #72 | partial | devShark as its own registry row also forks live data; client projects carrying competitors is one condition; the merges need judgement about which names are one topic. |
| #73 | done | The captures and the release entry landed. Retake a capture with `CHANGELOG_CAPTURE=1 npx playwright test e2e/changelog-capture.spec.ts --project=desktop` when its screen changes. |

## Where to pick up

The three steps once listed here are done: #85 settled the `schema.sql` question,
and the #73 captures and the release entry landed. The table above and
`NEEDED.md` hold what remains.

Nothing in this repository is waiting on another agent.
