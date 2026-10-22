# OwnDashboard — cost & scaling

Self-hosted, own-only tool on Vercel + Supabase. Model usage is restricted to the opt-in marketing worker. The stack is in `about-project.md`; prices checked 2026-07-21.

## What it costs

- **Personal, free tiers:** ~$0/month (Vercel Hobby, Supabase Free).
- **Always-on personal:** ~$25/month (Supabase Pro $25).
- Marketing is paused by default; when enabled, provider usage is billed separately, and and the optional services below stay on their free tiers.
- Job-board refreshes run only when the owner presses **Check for new offers** in Career (no daily scrape cron), so function time and outbound requests scale with use, not with the calendar.

## When to scale

- Supabase Free pauses after inactivity and caps at 500 MB → move to Pro ($25) for always-on.
- Add Upstash / Resend / PostHog / Sentry paid tiers only when their free quotas are actually exceeded.

## Keep costs down

Set budget alerts on each provider that has a paid tier; stay on free tiers until a real limit is hit.

## Marketing budget (implementation 2026-10-13)

The generation worker requires explicit current model pricing and caps each job at an estimated $0.13 with two attempts (owner decision 15, 22 October 2026; it was $0.25). The database admits at most eight new content jobs per owner in a rolling 24-hour window; duplicate job keys consume no new slot. This is an application guard, not a provider spending cap. Set provider caps before activation. Rendering makes no paid or network call: devShark uses its committed Claude Design-derived template, and DNESKAi slides render through the vendored carousel studio inside the existing marketing functions, about 0.2 s per slide on the local machine. The render cache keeps one JPEG per distinct slide in the private `marketing-assets` bucket, so an unchanged slide is never rendered or stored twice.

Claude Max, Anthropic API billing, n8n Cloud executions, Apify transcript add-ons and LangSmith entitlements are separate. The existing subscriptions remain unchanged; renewal dates and paid-plan classification are not inferred from an open browser session. No new paid plan was selected and no promotional-credit terms were accepted. Actual model pilot cost is not yet measured because credentials have not been provisioned. Record model usage, Actor charges, n8n execution totals and tracing usage separately by DNESKAi/devShark before expanding the schedule.
