# Career applications and document links

Career now stores the company directory in Supabase and connects saved positions to their Google Drive cover letters. The prepared list contains the company, role, posting and letter, while the sent list records the application date, subsequent responses, follow-ups and history. Both interfaces support Czech and English.

## Workflow

Career loads nothing until **Check for new offers / Zkontrolovat nové nabídky** is pressed; the saved, prepared and sent lists below appear after that press and stay loaded for the rest of the page session.

1. Save a position or open an imported one. Attach its Google Docs or Drive file URL and review the posting, letter and eligibility notes. Readiness is explicit: draft, ready or needs review.
2. Open **Applications to send / Přihlášky k odeslání**. The list includes every saved position with a letter link, including visibly marked items needing review. Search by company or role.
3. Apply through the employer's own site. Return to the review dialog, choose the actual date and select **Record sent application**. This records an action the owner has already taken; it does not contact an employer.
4. Open **Applied** and record the first substantive response separately from the hiring stage. An automated receipt does not count as a reply. Record a follow-up date, the contact at the company and the next step; the contact has its own two fields and the notes hold the rest.
5. Filter the sent cohort by application date and company/role. The response filter changes the visible list while the metric denominator remains the whole selected sent cohort.

## Stage board

**Applied** has two layouts and the dense list stays the default. The **Board**
toggle groups the same filtered cohort into five columns: Saved, Applied,
Interviewing, Offer and Closed.

- Four of the columns are `job_applications.status`. Closed holds both
  `rejected` and `withdrawn`, because neither is still moving; each card keeps
  its own badge, so which one it was stays visible.
- Saved is a different table. `saved_job_positions` rows have no application
  date, so a card there cannot be dragged into Applied — it carries the same
  **Review / mark as sent** button the prepared list uses, which opens the
  review dialog and records the date the owner actually applied through
  `record_job_application`. A drag that skipped it would invent that date.
- Dragging a card calls the same `update_job_application_progress` RPC the list
  uses, passing the existing response, follow-up and notes back unchanged: the
  function is a whole-row update, so an omitted argument would erase the value.
  The RPC appends a `status` history row only when the stage really changed, so
  the board's moves land in the same timeline as everything else.
- Every drag has a keyboard and touch equivalent. Each card carries a stage
  menu, which is the complete path without dragging; the drag handle is the
  only element with drag listeners and `touch-action: none`, so card text stays
  selectable and the links and buttons on it stay ordinary controls. In a
  keyboard drag the left and right arrows jump between columns.
- The board is the only horizontally scrolling region on the page, is labelled,
  and is reachable by keyboard.

`src/lib/jobs/board.ts` holds the column mapping, the grouping and the
follow-up rule. It is pure and clock-injected, and `applicationStats` derives
its "Follow-ups due" count from the same function, so the metric, the board
badge and the two overview surfaces cannot disagree.

## Follow-ups outside Career

A follow-up date on an active application (applied or interviewing) now shows up
where work is planned, derived at read time from the records already loaded:

- **Work overview** lists the due applications with the date, linking to Career.
- **Home** merges them into the hero's follow-up column beside client
  opportunities; each row is tagged with which pipeline it came from. Home loads
  `jobApplications` for this and nothing else — the scraped listings and the
  application history stay out of that route.

Nothing writes to `notifications`. Email or push reminders would need a cron
entry and Resend credentials; this surfacing needs neither and cannot drift out
of sync with the record.

## Contacts

`contact_name` and `contact_email` are structured columns on `job_applications`,
matching the pair `client_opportunities` already has, and are edited in the
response dialog. They are validated, never verified, and the application never
sends mail to either. They arrive with
`20260916141348_job_application_contacts.sql`; until it is applied, PostgREST
omits both keys and the dialog says so rather than offering fields that cannot
save.

## Why this integration

[Teal's tracker](https://www.tealhq.com/tools/job-tracker) and [Huntr's tracker](https://huntr.co/product/job-tracker) connect saved jobs, documents and hiring stages. OwnDashboard already had saved positions, applications and events, so extending those records keeps one history and avoids synchronizing a second tracking system. This is an implementation decision informed by those workflows, not a claim that their internal architecture is the same.

Google Drive remains the document editor; Supabase stores the document URL and a text snapshot. Opening a link uses the user's existing Google session and [Drive permissions](https://support.google.com/drive/answer/2494822?hl=en), with no new OAuth scope or public sharing required. Editing a Google Doc does not automatically update the dashboard's text copy. Before recording an application, paste the final submitted text into the review dialog when an exact historical snapshot matters. Deleting or moving a file into another account can make the link inaccessible.

A direct link is sufficient for this workflow and creates no extra background API traffic. Automatic document synchronization or mailbox response detection would require additional authorization, revision handling and reconciliation; neither is part of this implementation.

## Data and consistency

- `career_companies` stores the owner, company name, URL, category, country, research notes and last check date. The directory loads only when its Career subtab is open, with a user-scoped React Query key and a 1,000-row bound. Static companies remain only as public preview fixtures.
- `saved_job_positions` adds `cover_letter_url` and `readiness`. Existing saved positions keep their identities and drafts. The prepared list uses the presence of a letter link; readiness is a review flag, not a second application status.
- `job_applications` adds the letter URL, idempotent request ID, first-response date and response kind. Existing status and follow-up columns remain authoritative. A later migration adds the contact pair; the progress RPC does not take it, so the contact is a separate own-only update guarded by the same RLS policies and reported separately when it fails.
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
| Follow-ups due | Active applications — applied or interviewing — whose next follow-up timestamp has arrived. A malformed timestamp is skipped, not guessed at. |

A recent cohort has had less time to receive replies, so its response rate should not be compared directly with a mature cohort. The median describes received replies, not the expected response time of silent companies. Rejections can be recorded as negative replies; a status change alone does not imply a reply.

## Validation and deployment

Migration: `20260911080040_career_directory_and_application_pipeline.sql`. The migration was applied to the connected OwnDashboard project before application rollout. A transaction-rollback test verified the sent transition, null listing foreign key, repeat-call idempotency, preserved letter snapshot, progress history, invalid response dates, cross-user isolation and anonymous permission denial. No test application was retained.

The security advisor reported no new Career finding. It also reported existing unrelated `purge_old_cron_runs` execute grants and disabled leaked-password protection; those settings were not changed by this feature. See [function-grant remediation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

The Vercel project is already linked to this repository. [Vercel's GitHub integration](https://vercel.com/docs/git/vercel-for-github) builds branch previews and deploys the production branch. The additive database migration is compatible with the previous frontend, allowing the code to be reviewed before switching the interface.

Local verification passed lint, TypeScript and the production build, plus 276 unit tests. The full E2E run passed 45 checks and skipped 33 project duplicates; its two remaining stale/external-dependency test failures were corrected and both passed the targeted rerun, leaving all 47 executed checks covered. Details and visual limitations are recorded in `docs/design/visual-qa.md`.
