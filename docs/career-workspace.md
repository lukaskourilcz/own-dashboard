# Career workspace

Updated 7 September 2026. Scope: a personal React frontend/fullstack search for Prague and remote work from Czechia, plus an English/Czech application-writing workspace.

## Review and changes

The previous implementation explicitly classified Angular and Vue as frontend matches. Generic web signals could rescue Java/Python jobs. Czech ingestion required remote work, excluding Prague office jobs. Every job seen again received a new freshness timestamp, several rolling feeds were marked complete, and the prune total was overwritten rather than accumulated. The UI was a wide table; letter templates were behind application logging and followed the interface language.

The new flow preserves the existing catch-all route, route-scoped query state, shortlists, deletion tombstones, application snapshots, history and own-only letter/template persistence. It adds:

- A separate Saved stage between discovery and application. Saving snapshots the listing; pasting a URL reads available page metadata into editable fields. Cover-letter drafts and notes stay with the saved position. Confirming that the application was sent creates the application/history row and removes the saved position.

- A React requirement at ingestion and display boundaries. Explicit Angular, Vue, Svelte, React Native and off-stack language requirements are excluded conservatively. JavaScript never matches Java. Generic React software titles can qualify; backend-only titles and staff/principal/head roles do not.
- Prague office/hybrid jobs alongside explicit Czechia, EU/Europe/EMEA and worldwide remote locations. Remote-only country restrictions and unspecified locations fail closed. Junior/medior/senior filters include an unspecified category. Matching is keyword evidence, not a hiring probability or a guarantee of employment eligibility.
- A job list and detail pane; narrow screens open selected details in a dialog. Filters cover source, role, work location, level, search, shortlist and technology overlap. Duplicate company/title/location entries are collapsed in the visible list.
- Source refresh on a visit when the last run is over four hours old, plus the manual refresh and daily cron. No paid scraping starts on a visit.
- A separate authenticated, CSRF-checked availability request on each visit. Employer APIs verify published listings; other sources get bounded page checks. Closed/expired pages, redirects to generic pages, blocked pages and unverified results are hidden. A 200 response alone does not prove availability.
- English/Czech letter language independent of interface language. Paste the full posting, inspect matched skills and gaps, choose experience evidence, add a specific motivation sentence and build an editable draft. Copy and save named letters/templates, or record the exact sent letter with its application. This helper runs locally and makes no AI call.
- Fintech/banking prompts prioritize EmbedIT and Entain/Gibraltar; pharma/health prompts prioritize Controlant and Ersilia. Suggestions are based on keywords and user-confirmed experience, not semantic understanding. Operational experience is described separately from engineering work. Every claim remains editable.
- A searchable directory of 26 official employer career pages with Prague teams. Directory membership is not a claim of a current relevant vacancy.

## Research and sources

[Current portfolio](https://lukaskouril.dev/en) supplied React, TypeScript, Next.js, Node.js, PostgreSQL, Supabase and the relevant public experience. The user explicitly confirmed the Gibraltar/EmbedIT and Controlant/Ersilia industry mapping. The existing broader stack matcher is retained; Redis, Vercel and Supabase are now recognized as portfolio-supported skills.

[Greenhouse](https://docs.greenhouse.io/job-board.html), [Lever](https://github.com/lever/postings-api), and [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api) document public employer job APIs. Prefer employer feeds to syndication when practical. Public API access does not itself establish blanket redistribution rights. This is a personal authenticated tool that links to originals.

Live endpoints checked successfully during implementation:

- [Apify employer board](https://api.ashbyhq.com/posting-api/job-board/apify): 11 records before relevance filtering.
- [Rossum employer board](https://api.ashbyhq.com/posting-api/job-board/rossum.ai): 6 records before filtering; none should be assumed relevant merely because the employer is in Prague.
- [Outreach employer board](https://api.lever.co/v0/postings/outreach?mode=json): 33 records before filtering.

A proposed SentinelOne Greenhouse endpoint returned 404 and was not enabled. SentinelOne remains in the manual directory. The adapter supports Greenhouse for a future verified board token.

The existing eight board adapters remain, with stricter personal filtering and Prague coverage. Rolling-feed absence no longer triggers immediate deletion. HTML adapters depend on third-party markup and are not contractual APIs; failed or blocked requests cannot establish vacancy availability. The source panel shows actual run outcomes, including configured Apify tasks.

### Optional Apify connection

Set server-only `APIFY_TOKEN` and comma-separated `APIFY_JOB_TASK_IDS` in the deployment. Use saved tasks that return job descriptions and location/remote fields. The importer supports common flat job field aliases and nested company names. Unexpected data shapes may require an adapter extension; absence of credentials is not presented as a working integration.

The importer resolves a [successful run](https://docs.apify.com/api/v2/actor-task-runs-last-get), checks its completion time, and reads that fixed dataset. Only runs finished within 24 hours are accepted. Re-importing does not replace the original observation timestamp with the current time. It imports at most 1,000 rows/task and five tasks. It never starts an Actor, buys a plan, or schedules a paid run.

Research findings:

- [solidcode Jobs.cz actor](https://apify.com/solidcode/jobs-cz-scraper): candidate for a small task with React/Next.js/TypeScript, Praha and full descriptions. Verify its actual run price and output in Apify first; headline and plan pricing differ and run-start fees apply.
- [Lexis Jobs.cz actor](https://apify.com/lexis-solutions/jobs-cz-scraper/api): subscription plus usage, unattractive as the first choice for one personal search.
- [StartupJobs.cz actor](https://apify.com/martin1080p/startup-jobs-scraper/api): listed as under maintenance during research; do not rely on it.
- [LinkedIn actor](https://apify.com/bebity/linkedin-jobs-scraper): pricing text was inconsistent during a September transition. [LinkedIn terms](https://www.linkedin.com/legal/user-agreement) restrict scraping; actor availability is not permission. No LinkedIn Actor run was started.

### Design references

Inspected Mobbin images: [Glassdoor search/details](https://mobbin.com/screens/29c1d205-4f0e-4231-8499-8e9765dc31ed), [Mercor opportunities](https://mobbin.com/screens/db3c0878-3d38-4b6c-a469-c9c776872bef), [WRITER contextual suggestions](https://mobbin.com/screens/6865de54-3229-4b76-9e85-fc4a3499dd15), and [Grammarly review panel](https://mobbin.com/screens/b727d76e-6475-4a20-a8bd-d0ad05569b30). Applied persistent job context and reviewable writing suggestions within the existing dashboard's semantic theme.

The directory lives in `src/lib/jobs/companies.ts` and links to the researched official career destinations. Qest's company stack includes React alongside unrelated technologies, showing why company-level technology evidence cannot qualify every vacancy. Ackee and Salsita had career pages with no current vacancies during research; persistent pages are not proof of an opening.

## Availability and operating limits

Availability is a best-effort snapshot, not a promise that a vacancy remains open after the check. Job descriptions may be incomplete; conservative rejection can omit suitable mixed-stack roles. Location strings do not settle work authorization, payroll-country support or mandatory office attendance.

The availability endpoint reads at most 500 stored candidates and probes at most 100 non-employer pages per request, with a time budget. A “Check more listings” action continues with unchecked candidates. Unchecked results stay hidden; failed checks do not delete application history. Provider outages may temporarily produce an empty list. A source that serves an obsolete ad with no closure signal can still look open. The employer directory remains usable during outages.

Existing Supabase tables are reused; no new migration is required. Draft/template saving is explicit, not automatic. Application records save a snapshot that survives listing pruning. There is no automated submission or email sending.

The deployed Supabase credentials and Apify task configuration were unavailable in this workspace. No live owner data was read or modified for verification. Production configuration and actual saved-letter round trips require a signed-in production session. The cron now rejects requests when `CRON_SECRET` is missing instead of accepting unauthenticated execution.

## Release validation

- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run test`: 265 tests passed across 28 files, including filtering, source normalization, availability classification and industry-specific letter evidence.
- `npm run build`: passed with placeholder public Supabase values; this verifies compilation, not the production database connection.
- Live adapter follow-up: Apify returned three matching fullstack positions; Rossum and Outreach returned no positions passing the strict filter. These counts are a point-in-time observation, not an expected minimum.
- Existing desktop/mobile Career assertions were updated for the redesign. Browser/E2E tests were not executed in this session. No visual or live persistence validation is claimed.
