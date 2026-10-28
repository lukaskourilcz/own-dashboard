# OwnDashboard — cost & scaling

Self-hosted, own-only tool on Vercel + Supabase. Model usage is restricted to the opt-in marketing worker. The stack is in `about-project.md`; prices checked 2026-07-21.

## What it costs

- **Personal, free tiers:** ~$0/month (Vercel Hobby, Supabase Free).
- **Always-on personal:** ~$25/month (Supabase Pro $25).
- Marketing: the DNESKAi pipeline runs every night under the daily caps below; devShark has no live schedule. Provider usage is billed separately, and the optional services below stay on their free tiers.
- Job-board refreshes run only when the owner presses **Check for new offers** in Career (no daily scrape cron), so function time and outbound requests scale with use, not with the calendar.

## When to scale

- Supabase Free pauses after inactivity and caps at 500 MB → move to Pro ($25) for always-on.
- Add Upstash / Resend / PostHog / Sentry paid tiers only when their free quotas are actually exceeded.

## Keep costs down

Set budget alerts on each provider that has a paid tier; stay on free tiers until a real limit is hit.

## Marketing budget (implementation 2026-10-13)

The generation worker requires explicit current model pricing and caps each job at an estimated $0.13 with two attempts (owner decision 15, 22 October 2026; it was $0.25). The database admits at most eight new content jobs per owner in a rolling 24-hour window; duplicate job keys consume no new slot. This is an application guard, not a provider spending cap. Set provider caps before activation. Rendering makes no paid or network call: devShark uses its committed Claude Design-derived template, and DNESKAi slides render through the vendored carousel studio inside the existing marketing functions, about 0.2 s per slide on the local machine. The render cache keeps one JPEG per distinct slide in the private `marketing-assets` bucket, so an unchanged slide is never rendered or stored twice.

Claude Max, Anthropic API billing, n8n Cloud executions, Apify transcript add-ons and LangSmith entitlements are separate. The existing subscriptions remain unchanged; renewal dates and paid-plan classification are not inferred from an open browser session. No new paid plan was selected and no promotional-credit terms were accepted. The DNESKAi pilot on 22 October 2026 published two posts for about $0.046 in total. Record model usage, Actor charges, n8n execution totals and tracing usage separately by DNESKAi/devShark before expanding the schedule.

DNESKAi daily caps (rolling 24 hours, each refused rather than exceeded):

- Generation and the Haiku topic calls (titling, FACT or HYPE): $1.00, `MARKETING_DNESKAI_DAILY_GENERATION_USD`.
- Nightly collection (Jev and Apify Instagram profiles): $0.25; Jev alone costs about $0.002 a night.
- Reel transcripts for FACT or HYPE: $0.50, `MARKETING_DNESKAI_TRANSCRIPT_DAILY_USD`, off until the owner decides.
- TikTok CZ sound chart: $0.10, `MARKETING_DNESKAI_TIKTOK_DAILY_USD`, off until the owner decides.
- The Apify research plan: $126.00 of caps over four waves, from the $150 promotional credit, off until the owner approves it.

Reels render inside the existing Vercel function with `ffmpeg-static` and add Supabase Storage for MP4s up to 64 MiB each. The fixed `dneskai-reel/2` policy limits each image decoder to one thread, the filter graph to one and the H.264 encoder to two. Encoding time depends on the deck and runtime; the earlier seven-slide observation is not a latency guarantee. Physical MP4 keys include ordered slide JPEG hashes, exact track bytes and encoding policy. Caption, schedule and alt-text edits reuse an unchanged MP4 while each revision retains its own full approval hash and render event. Storage outages stop rendering instead of pretending the cache is empty. This avoids redundant encoding and copies for those edits; it does not establish measured production savings or serialize concurrent render starts. A 28 October local two-slide comparison records lower CPU time and peak memory but longer wall time under those limits; [the raw samples](docs/reports/app-wide-audit-2026-10-23/reel-thread-resources.json) are local observations, not Vercel billing estimates.


## Bank processing bounds — 24 October 2026

Existing bank sync shares one 40-second asynchronous processing budget per manual/cron pass inside a 60-second function limit. The signal interrupts provider calls, database reads and SDK retry waits; failed/unprocessed connections are counted and unfinished cursors do not advance. No-op balance updates are skipped. Bank, CSV and retroactive rule evaluation refuse excessive complete work before imports/updates. These are application bounds, not measured latency savings or provider spending caps. Existing plans and provider activation remain unchanged.

The 25 October source-recovery review reuses immutable EN/CS date/currency/relevance/age formatters and indexes newest candidate dates once per render. Twenty offline sources, two hundred candidates, fourteen runs and sixty events keep identical actual-component HTML across both locales and DST transitions. Five interleaved samples measure median CPU of 104.504833 → 71.092916 ms for twelve renders. See [raw local measurements](docs/reports/app-wide-audit-2026-10-23/source-recovery-cpu.json); this does not establish production response time or hosting savings.

The prepared migration 118 keeps daily cost and 24-hour tick aggregates inside Postgres, returning at most seven daily records and twenty meaningful tick details. The client reads only thirty failed/uncertain job details and no raw tick page. Aggregate truth no longer depends on REST's row cap. A narrow partial owner/date index supports the actual job predicate; the [local authenticated-RLS query plan](docs/reports/app-wide-audit-2026-10-23/cost-aggregate-query-plan.json) selects it for 120 current jobs among 10,120 synthetic records. This is local plan evidence, not a production latency or billing claim. The migration remains unapplied.


## Local runtime packaging — 28 October 2026

Finding 392 removes local browser-test outputs from marketing function traces. A matched cold Darwin-arm64 build keeps all original QA files intact and every non-QA trace path, while each of seven affected packages removes 67.1 MB of QA bytes. Execute's listed total falls from 115.9 MB to 48.8 MB; media is unchanged. [Exact comparison and limits](docs/reports/app-wide-audit-2026-10-23/runtime-package-comparison-392.json). These are uncompressed local listed-file totals with QA outputs present, not hosting-cost or latency measurements; clean Git/CI builds without those outputs do not have the measured overhead. Native libraries, fallback, fonts, templates and ffmpeg remain included. Provider spending caps do not change.
