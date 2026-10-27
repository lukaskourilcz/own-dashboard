# Career applications and document links

Career now stores the company directory in Supabase and connects saved positions to their Google Drive cover letters. The prepared list contains the company, role, posting and letter, while the sent list records the application date, subsequent responses, follow-ups and history. Both interfaces support Czech and English.

## Workflow

Career displays public Oslo research immediately. Opening a role or saved/workflow tab loads private records on demand; **Check for new offers / Zkontrolovat nové nabídky** also refreshes feeds and availability. The prepared queue accepts explicit ready text-only drafts as well as Google Docs links. See [current Oslo workflow](career-workspace.md).

1. Save a position or open an imported one. Attach its Google Docs or Drive file URL and review the posting, letter and eligibility notes. Readiness is explicit: draft, ready or needs review.
2. Open **Applications to send / Přihlášky k odeslání**. The Ready list includes explicitly ready drafts, including text-only letters, and valid Google letter links unless marked needs review. Drafts and items needing review stay in the other saved-position view. Search by company or role.
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
  `record_captured_job_application`, using the original Saved identity/version. A drag that skipped review would invent that date.
- Dragging a card calls `update_captured_job_application` through the same
  bounded writer as the response dialog. It captures the original owner and
  complete application version, then sends only the changed status. Omitted
  response, follow-up, notes and contact fields remain unchanged. A stale
  version refuses the write; an uncertain result offers explicit recovery.
  Only an actual stage change adds a status event, in the same transaction.
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

- `career_companies` stores the owner, company name, URL, category, country, research notes and last check date. The directory loads only when its Career subtab is open, with a user-scoped React Query key and a 1,000-row bound. Public Oslo career destinations are available in production and merge with owner links; Czech destinations require the Settings opt-in.
- `saved_job_positions` adds `cover_letter_url` and `readiness`. Existing saved positions keep their identities and drafts. The Ready view uses the shared readiness rule: explicit ready text-only drafts or valid Google letter links not marked needs review. Readiness stays distinct from a sent application status.
- `job_applications` stores the letter URL, request identity, first-response date, response kind and contacts. Status and follow-up columns remain authoritative. The captured progress RPC commits submitted contact and progress changes together; a contact-only change adds no event.
- `record_captured_job_application` verifies the expected owner and original Saved version, records the reviewed application and initial event, and consumes that exact Saved row in one transaction. Source metadata comes from its private Saved snapshot. Explicit retry of the same captured intent returns the original application without overwriting later progress; changed or foreign intents are refused. A manually saved position keeps its null listing foreign key.
- `update_captured_job_application` accepts a bounded seven-field patch with the captured owner/id/version. It commits progress, contacts and the relevant changed history atomically; unchanged values cause no rewrite/event. Dates retain the owner-day validation. The older RPCs remain in canonical SQL for compatibility and are not the current board/dialog write path.

The captured writers depend on prepared migrations 132 (`20261026182155_captured_career_application.sql`) and 133 (`20261026195100_captured_career_progress.sql`). Apply the complete audit chain 87–140 in order before deploying these callers; see the [current migration guide](migration-guide.md). This source description does not imply those files are already applied in Production.

The functions use `SECURITY INVOKER`, an empty search path and explicit owner checks, following [Supabase's function guidance](https://supabase.com/docs/guides/database/functions). Directory access has explicit authenticated grants and [own-only RLS policies](https://supabase.com/docs/guides/database/postgres/row-level-security). [PostgreSQL transaction and row locks](https://www.postgresql.org/docs/current/explicit-locking.html) keep the sent transition atomic. Anonymous callers cannot read the directory or execute these functions.

Career and professional exports include the new directory; existing saved/application exports automatically include the added fields. Private company imports, real letters and owner identifiers are data, and are not committed as public preview fixtures.

## Metric definitions

| Metric | Definition |
| --- | --- |
| Sent | Number of recorded applications in the selected cohort |
| Last 7 / 30 days | Seven or thirty calendar dates including today in the saved owner timezone (Europe/Prague by default); future dates excluded |
| Active | Applied or interviewing |
| Responses | Applications with an explicitly recorded response kind and valid date |
| Response rate | Responses divided by sent applications in the selected cohort; blank for zero applications |
| Median days to response | Median calendar-day difference from sending to first response, among replies only |
| Follow-ups due | Active applications — applied or interviewing — whose next follow-up timestamp has arrived. A malformed timestamp is skipped, not guessed at. |

A recent cohort has had less time to receive replies, so its response rate should not be compared directly with a mature cohort. The median describes received replies, not the expected response time of silent companies. Rejections can be recorded as negative replies; a status change alone does not imply a reply.

## October 2026 audit changes

Prepared migration `20261023183345_career_owner_day.sql` aligns both transactional date checks with the owner timezone. It adds an authenticated, security-invoker date helper and preserves request idempotency and history. Apply it before deploying the timezone-aware form; it is still unapplied while the app-wide audit is in progress. An invalid legacy timezone falls back to Europe/Prague.

A delayed URL enrichment cannot replace a newer URL or manually edited fields. URLs containing credentials or malformed values are rejected. Failed application deletion restores the application and its history; an optional contact-write failure preserves confirmed progress and the unsaved contact fields. Draft saving and recording a sent application cannot run together. The Strong fit filter uses the same level as its badge (75% or higher). Public research remains dated evidence and does not imply current vacancy availability or a completed relocation.

## Validation and deployment

Migration: `20260911080040_career_directory_and_application_pipeline.sql`. The migration was applied to the connected OwnDashboard project before application rollout. A transaction-rollback test verified the sent transition, null listing foreign key, repeat-call idempotency, preserved letter snapshot, progress history, invalid response dates, cross-user isolation and anonymous permission denial. No test application was retained.

The security advisor reported no new Career finding. It also reported existing unrelated `purge_old_cron_runs` execute grants and disabled leaked-password protection; those settings were not changed by this feature. `20260925210000_restrict_purge_old_cron_runs.sql` later revoked the grants. See [function-grant remediation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

The Vercel project is already linked to this repository. [Vercel's GitHub integration](https://vercel.com/docs/git/vercel-for-github) builds branch previews and deploys the production branch. The additive database migration is compatible with the previous frontend, allowing the code to be reviewed before switching the interface.

Local verification passed lint, TypeScript and the production build, plus 276 unit tests. The full E2E run passed 45 checks and skipped 33 project duplicates; its two remaining stale/external-dependency test failures were corrected and both passed the targeted rerun, leaving all 47 executed checks covered. Details and visual limitations are recorded in `docs/design/visual-qa.md`.


### Direct availability checks

Direct public-page verification admits at most 100 listings in batches of 15. Its in-flight work shares a 22-second budget; each listing has one 15-second allowance across redirects and body download, capped at 1.5 MB. Caller cancellation reaches these requests. In-flight failures become unknown, and unstarted rows receive no invented state. This bound covers the direct verifier, not preceding route auth/database or native-board fetches.

Structured expiry uses only a JSON-LD `JobPosting` whose normalized title and URL match the registered listing; query identities stay distinct. Unrelated types/recommendations and arbitrary script fields cannot close that job or independently establish it open. Conflicting or malformed dates, oversized graph traversal, challenge pages and mixed apply/closed copy remain unknown. A date without a timezone waits until that calendar date ends in UTC−12, a conservative application policy rather than a provider guarantee. Datetimes require an explicit offset. This follows the per-listing meaning of [JobPosting](https://schema.org/JobPosting) and [Google's job-posting guidance](https://developers.google.com/search/docs/appearance/structured-data/job-posting); the strict local identity and ambiguity rules are OwnDashboard safeguards.

Page classification scans complete bounded markup without whole-page backtracking expressions. It ignores comments and script/style text, consumes real attributes with quoted/unquoted values, and refuses unfinished/excessive markup as unknown. Limits are 1.5 million decoded characters, 10,000 tags, 4,096 characters per tag, forty JSON-LD scripts and five hundred structured nodes, in addition to the download byte ceiling. [Offline CPU evidence](reports/app-wide-audit-2026-10-23/career-html-cpu.json) records the malformed-input repair; it does not estimate production bills.
