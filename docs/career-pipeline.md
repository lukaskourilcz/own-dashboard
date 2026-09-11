# Career applications and document links

Career now stores the company directory in Supabase and connects saved positions to their Google Drive cover letters. The prepared list contains the company, role, posting and letter, while the sent list records the application date, subsequent responses, follow-ups and history. Both interfaces support Czech and English.

## Workflow

1. Save a position or open an imported one. Attach its Google Docs or Drive file URL and review the posting, letter and eligibility notes. Readiness is explicit: draft, ready or needs review.
2. Open **Applications to send / Přihlášky k odeslání**. The list includes every saved position with a letter link, including visibly marked items needing review. Search by company or role.
3. Apply through the employer's own site. Return to the review dialog, choose the actual date and select **Record sent application**. This records an action the owner has already taken; it does not contact an employer.
4. Open **Applied** and record the first substantive response separately from the hiring stage. An automated receipt does not count as a reply. Record a follow-up date, contact details and next steps in the notes.
5. Filter the sent cohort by application date and company/role. The response filter changes the visible list while the metric denominator remains the whole selected sent cohort.

## Why this integration

[Teal's tracker](https://www.tealhq.com/tools/job-tracker) and [Huntr's tracker](https://huntr.co/product/job-tracker) connect saved jobs, documents and hiring stages. OwnDashboard already had saved positions, applications and events, so extending those records keeps one history and avoids synchronizing a second tracking system. This is an implementation decision informed by those workflows, not a claim that their internal architecture is the same.

Google Drive remains the document editor; Supabase stores the document URL and a text snapshot. Opening a link uses the user's existing Google session and [Drive permissions](https://support.google.com/drive/answer/2494822?hl=en), with no new OAuth scope or public sharing required. Editing a Google Doc does not automatically update the dashboard's text copy. Before recording an application, paste the final submitted text into the review dialog when an exact historical snapshot matters. Deleting or moving a file into another account can make the link inaccessible.

A direct link is sufficient for this workflow and creates no extra background API traffic. Automatic document synchronization or mailbox response detection would require additional authorization, revision handling and reconciliation; neither is part of this implementation.

## Data and consistency

- `career_companies` stores the owner, company name, URL, category, country, research notes and last check date. The directory loads only when its Career subtab is open, with a user-scoped React Query key and a 1,000-row bound. Static companies remain only as public preview fixtures.
- `saved_job_positions` adds `cover_letter_url` and `readiness`. Existing saved positions keep their identities and drafts. The prepared list uses the presence of a letter link; readiness is a review flag, not a second application status.
- `job_applications` adds the letter URL, idempotent request ID, first-response date and response kind. Existing status and follow-up columns remain authoritative.
- `record_job_application` records the application, adds its initial event and consumes the saved position in one transaction. An owner/request unique key and transaction lock make retries return the original record. A manually saved position retains a null listing foreign key instead of incorrectly using its saved-row UUID.
- `update_job_application_progress` updates the stage, response and follow-up together, adding history only when values change. Response dates cannot precede sending or lie in the future through the RPC.

The functions use `SECURITY INVOKER`, an empty search path and explicit owner checks, following [Supabase's function guidance](https://supabase.com/docs/guides/database/functions). Directory access has explicit authenticated grants and [own-only RLS policies](https://supabase.com/docs/guides/database/postgres/row-level-security). [PostgreSQL transaction and row locks](https://www.postgresql.org/docs/current/explicit-locking.html) keep the sent transition atomic. Anonymous callers cannot read the directory or execute these functions.

Career and professional exports include the new directory; existing saved/application exports automatically include the added fields. Private company imports, real letters and owner identifiers are data, and are not committed as public preview fixtures.

## Metric definitions

| Metric | Definition |
| --- | --- |
| Sent | Number of recorded applications in the selected cohort |
| Last 7 / 30 days | Sent dates within those rolling windows; future dates excluded |
| Active | Applied or interviewing |
| Responses | Applications with an explicitly recorded response kind and valid date |
| Response rate | Responses divided by sent applications in the selected cohort; blank for zero applications |
| Median days to response | Median calendar-day difference from sending to first response, among replies only |
| Follow-ups due | Active applications whose next follow-up timestamp is due |

A recent cohort has had less time to receive replies, so its response rate should not be compared directly with a mature cohort. The median describes received replies, not the expected response time of silent companies. Rejections can be recorded as negative replies; a status change alone does not imply a reply.

## Validation and deployment

Migration: `20260911080040_career_directory_and_application_pipeline.sql`. The migration was applied to the connected OwnDashboard project before application rollout. A transaction-rollback test verified the sent transition, null listing foreign key, repeat-call idempotency, preserved letter snapshot, progress history, invalid response dates, cross-user isolation and anonymous permission denial. No test application was retained.

The security advisor reported no new Career finding. It also reported existing unrelated `purge_old_cron_runs` execute grants and disabled leaked-password protection; those settings were not changed by this feature. See [function-grant remediation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

The Vercel project is already linked to this repository. [Vercel's GitHub integration](https://vercel.com/docs/git/vercel-for-github) builds branch previews and deploys the production branch. The additive database migration is compatible with the previous frontend, allowing the code to be reviewed before switching the interface.

Local verification passed lint, TypeScript and the production build, plus 276 unit tests. The full E2E run passed 45 checks and skipped 33 project duplicates; its two remaining stale/external-dependency test failures were corrected and both passed the targeted rerun, leaving all 47 executed checks covered. Details and visual limitations are recorded in `docs/design/visual-qa.md`.
