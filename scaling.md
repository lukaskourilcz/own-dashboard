# OwnDashboard — cost & scaling

Self-hosted, own-only tool on Vercel + Supabase. It makes no model calls. The stack is in `about-project.md`; prices checked 2026-07-21.

## What it costs

- **Personal, free tiers:** ~$0/month (Vercel Hobby, Supabase Free).
- **Always-on personal:** ~$25/month (Supabase Pro $25).
- Nothing is priced per use by default: there is no model usage, and the optional services below stay on their free tiers.
- Job-board refreshes run only when the owner presses **Check for new offers** in Career (no daily scrape cron), so function time and outbound requests scale with use, not with the calendar.

## When to scale

- Supabase Free pauses after inactivity and caps at 500 MB → move to Pro ($25) for always-on.
- Add Upstash / Resend / PostHog / Sentry paid tiers only when their free quotas are actually exceeded.

## Keep costs down

Set budget alerts on each provider that has a paid tier; stay on free tiers until a real limit is hit.
