# Home, Strategy execution and project costs

Owner request dated 10 November 2026. Release verification is recorded below after completion.

Home now shows the five newest unfinished backlog tasks and up to five saved Career positions awaiting an application, with prepared applications first. Already applied positions are excluded by listing ID and canonical URL. No date, events, deadlines, follow-ups, focus garden, finance widgets or customization appear there. When fewer than five records qualify, the list contains the available records.

Strategy, Tasks, Backlog and Home share the canonical backlog table and query cache. The live database has 42 Strategy tasks: 21 per brand, each with 18 AI and 3 JA tasks. Four existing LinkedIn/Facebook setup tasks were reused. AI covers terminal and Chrome execution. JA covers exact paid-plan decisions, final publishing approval and personal account verification when required. Classification alone does not start paid research or approve publication.

## Financial evidence imported

Supabase MCP applied the three migrations and imported 13 additional cash/refund transactions and 13 period-evidence rows. Two previously recorded dedicated payments (Foxy and devshark.app) received their project attribution. No credentials, payment-card information or signed invoice downloads were copied into source.

| Project | Direct recorded payments | Additional dated usage evidence |
|---|---|---|
| heyDarlink | Foxy Starter: 9 USD on 6 September, 6 October and 6 November; Foxy 100 USD on 5 November; Higgsfield settled 1,615.60 CZK on 11 October (invoice 71.39 USD) | Supabase LINKA compute 7.70 USD; ambient frame estimates 1.219906 USD |
| devShark | devshark.app domain 12.09 USD on 20 June | Vercel 10.399537606009027 USD; Supabase primary/recovery compute 7.70 USD each; generation drafts without a price remain unknown |
| DNESKAi | No dedicated cash receipt found in this audit | Vercel 0.8801078674731871 USD; illustration classification 2.792126 USD including refused rows; owner-scoped source/generation ledgers load dynamically |
| NaviGym | No dedicated cash receipt found in this audit | Vercel 8.290278147890476 USD; Supabase compute 7.70 USD |

The owner explicitly confirmed payment of Foxy's 100 USD in this conversation. The receipt says “Offline Payment”; the transaction records both facts and counts it as paid. Higgsfield's verified settlement is stored once in CZK, with its original USD amount in the note. Its renewal cycle was not verified, so no monthly subscription was invented.

Vercel usage covers 18 October 07:00 UTC through 10 November 08:00 UTC, filtered from 39,146 billing-export records by actual charge periods and project tags. Gross usage precedes credits, taxes and final settlement. Supabase compute is the rounded displayed snapshot of 573 hours per project, observed 10 November during the 18 October–18 November cycle. Each line keeps its own source, period and verification date.

Shared ownDashboard evidence contains Vercel 41.05045060437361 USD, Supabase compute 7.70 USD, unattributed branching 7.70 USD and the organization's 10 USD compute credit. They are not assigned to DNESKAi/devShark by guesswork. Existing Vercel/Supabase/Claude subscription splits remain explicitly labeled planning estimates. Vercel/Supabase next cycle ends were verified as 18 November; stale unverified Foxy/Claude renewal dates were cleared.

Additional shared cash records: Vercel 60.82 USD (18 September), 72.38 USD (18 October), partial refunds 0.05 USD (29 September), 0.49 USD and 0.05 USD (22 October); Supabase 58.94 USD (18 September), 64.87 USD (18 October); Claude 217.80 EUR each on 28 September and 28 October. Partial refunds reduce net paid spend. The unpaid Apify 22.99 USD invoice is not recorded as paid. No paid Apify run was started.

Usage is not added to invoice payments, and credits are not treated as expenses. Original currencies remain visible; display conversions use existing fixed FX. Missing evidence means unknown rather than zero. Provider billing snapshots and global image-ledger aggregates require a future refresh; the owner-scoped marketing production endpoint refreshes when Finance is opened.

## Validation

- `npm run lint`: passed.
- `npx tsc --noEmit`: passed, including the final finance endpoint/components.
- `npm run test`: 329 files passed, 1 skipped; 3,094 tests passed, 3 skipped.
- `npm run build`: passed as the production-build step of the Chrome Playwright web server. Existing dynamic tracing warnings remain.
- Focused Chrome E2E: 35 passed / 14 skipped, with one unrelated subscription day-count assertion failing when the run crossed local midnight; that assertion was corrected and its focused rerun passed (1/1). All new Home/JA-AI/finance tests and Strategy, calendar, Backlog and workspace flows passed. EN/light and CS/dark, six responsive widths, axe, no document overflow and no new console errors were verified.
- Final fresh-build focused Chrome release run: 37 passed / 15 skipped / 0 failed. It includes the corrected midnight assertion and the marketing-calendar fixture case.
- Full Chrome E2E: 255 passed / 82 skipped / 13 failed (12.1 minutes). Twelve failures match the previously reproduced Lab visual, keyword-colour wait and favicon CORS classes documented in the growth Strategy release report. One additional marketing-calendar fixture assertion lost its current-day entry when the static preview crossed local midnight; the fresh-build focused result is recorded below. No visual baselines were regenerated.
- Production database smoke: the owner sees all 13 evidence rows and 42 Strategy tasks; a stranger session sees zero of either. Parent-write/duplicate/period constraints passed isolated database tests.
- Supabase security advisors reported no finding on the new project-cost fields/policies or executor category. Existing service-only-table notices and authenticated SECURITY DEFINER warnings remain outside this change, alongside disabled leaked-password protection. References: [RLS notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [function warnings](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- `git diff --check`: passed.

PR: https://github.com/lukaskourilcz/own-dashboard/pull/322. All implementation commits use Lukas <58434653+lukaskourilcz@users.noreply.github.com> and were pushed individually. Deployment verification follows below.
