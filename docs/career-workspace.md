# Career workspace

Updated 6 November 2026. The market is Prague and remote work open to Czechia, as employment or B2B. The Oslo search (16 October 2026) is retired; its saved positions, letters and applications stay in the owner account and remain visible in the saved, sent and letter tabs.

## Research workflow

The default **Researched roles / Prověřené role** tab shows public research immediately, without fetching private records or starting scrapers. `czech-research.ts` holds the role assessments and `czech-companies.ts` the official careers directory; `research.ts` holds the market-neutral types, scoring and freshness helpers. Directory membership is not a claim of a suitable current vacancy. The [research register](career-czech-research.md) links to every source and is generated from the data files.

The priority grid shows profile matches of at least 75%, excludes flagged barriers and stale research, and sorts by score. B2B and contract roles count as priorities because freelance work is an option. Filters cover Prague, remote, B2B and contracts, AI and automation, senior stretches and roles with a barrier, plus a source filter. Every card opens a Radix dialog with a source link, working arrangement, salary/deadline when known, candidate evidence, gaps, score breakdown and the private editable letter. Keyboard focus returns to the triggering card; unsaved edits have an explicit discard path.

Opening a role or a saved/workflow tab is an explicit request to load owner-scoped records. **Check for new offers / Zkontrolovat nové nabídky** refreshes all feeds, loads records and checks availability. There are no focus refreshes, paid Actor runs or model calls in Career. A failed private-data load stays retryable rather than looking like an empty account.

## Scoring and freshness

Scores are manual profile-match assessments against lukaskouril.dev, never probabilities of getting hired: stack 40, experience 25, domain 15, location 10 and language 10. A mandatory working language outside the profile caps a role at 49%; other documented mandatory barriers (degree, clearance, on-site outside Prague) cap it at 59%. Role-specific gaps stay explicit, including Java/.NET/Python depth, five-plus-year requirements and degree conditions that appear only in a portal's structured fields.

Job-board and LinkedIn roles were posted roughly within six weeks of the research date; dates are shown only where the source showed one, and LinkedIn may display a refreshed date. Older employer-site roles can appear while still listed. Research older than 35 days and passed deadlines leave the priority view. API refresh does not reset the research date.

The dialog's **Check availability** makes one authenticated, CSRF-checked, rate-limited request for a known research ID. The allowed hosts are the public job boards plus each researched vacancy's own host; arbitrary URLs and redirects elsewhere are refused. Closed/expired, blocked and unknown results are distinguished; HTTP 200 alone is insufficient. LinkedIn and some Jobs.cz employer pages can stay unknown to a server check. Always inspect the original before applying.

## Sources

Live feeds: StartupJobs, Jobs.cz, Prace.cz, the curated leads and the Apify, Rossum and Outreach employer boards, plus the remote boards filtered to Czech-compatible locations. The Norway-only Sanity and Enode feeds were removed. Prague offices and remote work explicitly open to Czechia, the EU, EMEA or worldwide pass discovery; another Czech city is not treated as a Prague office, and unknown remote scopes fail closed. Senior titles and adjacent stacks are assessed instead of discarded; unrelated disciplines and mobile-only roles stay excluded.

The careers directory combines the public Czech research with owner-added `career_companies` links. LinkedIn, StartupJobs, Jobs.cz, Prace.cz, Cocuma and JobStack searches are linked as manual browsing destinations, not as scrape integrations.

## Retired preference

The Settings checkbox **Show Czech Career contents** and its hook were removed. The `user_preferences.show_czech_career` column from `20261015234547_oslo_career_preferences.sql` stays in the database untouched and is no longer read or written; no migration was needed.

## Private letters and application tracking

The existing sent-date, stage board, response statistics, contacts and follow-up workflows are retained. `record_job_application` atomically snapshots an actual sent application; saving or copying a draft never marks it sent. Career does not submit applications or messages. The letter guidance asks for the listing's language, Prague as the base, current availability and the preferred employment form, and no invented degree, tenure or expertise. Public preview fixtures contain fictional letters only.

## Limits

Research is a dated snapshot. Agency adverts may duplicate a direct employer role; check recruiter-client overlap before applying twice. Some Jobs.cz employer pages load their description with JavaScript, so those roles were scored conservatively from the title and summary. Availability checks are bounded, fail visibly and do not delete application history. Public summaries link to original ads; no third-party job descriptions are republished. The catch-all shell, route-scoped query loading, no-model-call boundary and finance behavior remain intact.
