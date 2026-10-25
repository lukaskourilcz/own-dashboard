# Career workspace

Operating boundaries updated 25 October 2026; the public research below remains the dated 16 October snapshot. The default market is Oslo, its commuting area and remote work explicitly compatible with Norway. Interface language remains Czech by default; application letters default to English.

## Oslo workflow

The default **Oslo** tab displays public research immediately, without fetching private records or starting scrapers. `oslo-research.ts` contains 33 role assessments; `oslo-companies.ts` contains 41 official careers destinations checked on 16 October. Directory membership is not a claim of a suitable current vacancy. [Research register](career-oslo-research.md) links to every source.

The priority grid shows profile matches of at least 75%, excludes explicit barriers, stale research and alternative part-time contracts, and sorts by score. All researched roles, senior stretches, AI roles and contracts remain inspectable through filters. Every card opens a Radix dialog with a source link, working arrangement, salary/deadline when known, candidate evidence, gaps, score breakdown and the private editable English letter. Keyboard focus returns to the triggering card; unsaved edits have an explicit discard path.

Opening a role or a saved/workflow tab is an explicit request to load owner-scoped records. **Check for new offers / Zkontrolovat nové nabídky** refreshes selected feeds, loads records and checks availability. There are no scheduled scrapes, focus refreshes, paid Actor runs or model calls in Career. A failed private-data load stays retryable rather than looking like an empty account. Refresh captures the original server-verified owner before waiting and confirms an owner-stamped result before activating private records or announcing success. Same-frame duplicate requests are blocked. An accepted check with a failed local reload offers a local retry without repeating the feed check; a timeout remains unconfirmed.

## Scoring and freshness

Scores are manual profile-match assessments, never probabilities of getting hired: stack 40, experience 25, domain 15, location 10 and language 10. Required Norwegian caps a role at 49%; other documented mandatory barriers cap it at 59%. Role-specific gaps remain explicit, including Python/.NET depth, degree requirements, tenure and security-clearance eligibility. The assessment does not know applicant competition or internal hiring decisions.

On LinkedIn only original posting ages within five weeks were saved. Twelve newly saved listings were checked individually at 2 days to 3 weeks old; Attensi was already saved and verified at one week. Six Robotics' frontend page only established a repost date, so it was not saved there. Older active direct-employer roles can still appear, clearly sourced as employer listings. The registry does not invent exact posting dates from relative labels. Research older than 35 days and passed deadlines leave the default priority view. API refresh does not reset the original research date.

The dialog's **Check availability** makes one authenticated, CSRF-checked, rate-limited request for a known research ID. It cannot fetch arbitrary URLs. Closed/expired, blocked and unknown results are distinguished; HTTP 200 alone is insufficient. LinkedIn may require browser authentication and therefore remain unknown to a server check. Always inspect the original before applying.

## Sources and Czech archive

Direct public Ashby feeds for [Sanity](https://api.ashbyhq.com/posting-api/job-board/sanity) and [Enode](https://api.ashbyhq.com/posting-api/job-board/Enode) were verified live. Ashby secondary locations are retained: a London-first record can also offer Oslo. General remote feeds remain bounded discovery sources. Norway is not treated as EU-only; unknown and incompatible remote countries fail closed. Senior/staff/principal titles and adjacent frontend/backend stacks are assessed instead of discarded; unrelated disciplines and mobile-only roles remain excluded.

In Settings, **Zobrazit český obsah Kariéry / Show Czech Career contents** is OFF by default and syncs through `user_preferences.show_czech_career`. Off hides Prague/Czech saved records, company links, CV shortcut and source metadata; refresh/availability also skip Czech sources. Existing records and adapters are preserved. Czech StartupJobs, Jobs.cz, Prace.cz, the previous curated set, Prague employer feeds and unknown-scope Apify tasks execute only with the opt-in. Another Norwegian city is not automatically an Oslo office; Norway-wide remote must be established.

The official directory combines public Norway research with owner-added links. Existing Czech links return with the checkbox. LinkedIn, The Hub saved jobs, FINN, NAV and Startuplab are manual browsing destinations, not advertised as functioning scrape integrations.

## Private letters and application tracking

The 33 offline-prepared English letters were inserted into the existing owner's `saved_job_positions` without overwriting existing drafts. Personal text, contact details and Google Docs links stay outside this public repository. Four existing native Google Docs letters are linked; text-only drafts can also be marked ready. The shared English CV shortcut points to the revised CV, including n8n, LangChain, Apify and TypeSafe AI (Jev).

The existing sent-date, stage board, response statistics, contacts and follow-up workflows are retained. `record_job_application` atomically snapshots an actual sent application; saving or copying a draft never marks it sent. No employer applications or messages are submitted by Career. The letter review tab compares the older templates with the user's personal style: preserve warmth and company-specific motivation, add concrete evidence, condense chronology, remove repeated live-coding promises, correct relocation wording and distinguish LLM integration from model training.

The additive preference migration is `20261015234547_oslo_career_preferences.sql`, matching production history. Existing owner-only RLS remains enabled on preferences, saved positions, applications and companies. A private local backup preceded the additive data insert. Public preview fixtures contain fictional letters only.

## Optional legacy Apify import

With Czech content enabled, server-only `APIFY_TOKEN` and comma-separated `APIFY_JOB_TASK_IDS` can import already completed saved tasks. The importer accepts a successful, non-future run completed within 24 hours and retains its original observation time. It verifies run/dataset identities and the direct task id; named tasks use their documented scoped endpoint. Each whole dataset must contain at most 1,000 raw records, confirmed by offset/count/total headers and a 1,001-record sentinel request. Hidden diagnostic fields are skipped while empty items remain in the counted window. Missing or inconsistent pagination and larger datasets are unavailable rather than silently partial. At most five distinct valid configured task references are read. One import has a fifteen-second total lifetime and ten seconds per GET/body phase, with parent cancellation, late/refused-body release and decoded text bounds (65,536 characters for metadata; 8,388,608 for dataset JSON). Eligible rows retain the registered job-host policy and bounded display fields; invalid publication dates become unknown. It never starts an Actor or schedules a paid run. Task output must establish role, location and stack; credentials do not prove a working integration. These adapter checks do not make a discovery feed complete, prove every scrape database receipt or serialize concurrent refreshes. Current endpoint/pagination contracts were checked against the [last task run](https://docs.apify.com/api/v2/actor-task-runs-last-get) and [dataset items](https://docs.apify.com/api/v2/dataset-items-get) references on 25 October.

## Limits

Research is a dated snapshot. A live page can retain a passed deadline, as Monil does. Company pages can carry unrelated embedded or specialist ML jobs. LLM tooling is not evidence of computer-vision training expertise. Six Robotics' citizenship and clearance conditions need individual confirmation; EU citizenship alone is insufficient. Agency adverts may duplicate a direct employer role. Choose one appropriate Aidn level and check recruiter-client overlap before submitting duplicates.

Availability checks are bounded, fail visibly and do not delete application history. Public summaries link to original ads; no complete third-party job descriptions are republished in the research registry. The catch-all shell, route-scoped query loading, no-model-call boundary and existing invoice/finance behavior remain intact.
