# OwnDashboard — cost & scaling

Self-hosted, own-only tool on Vercel + Supabase with pay-as-you-go AI. The stack is in `about-project.md`; prices checked 2026-07-21.

## What it costs

- **Personal, free tiers:** ~$0/month + AI usage (Vercel Hobby, Supabase Free).
- **Always-on personal:** ~$25–40/month (Supabase Pro $25; light AI).
- AI is the only real variable — usually a few dollars. Set provider budget alerts rather than trusting an estimate.

## When to scale

- Supabase Free pauses after inactivity and caps at 500 MB → move to Pro ($25) for always-on.
- Add Upstash / Resend / PostHog / Sentry paid tiers only when their free quotas are actually exceeded.

## Keep costs down

Set budget alerts on Anthropic and each provider; stay on free tiers until a real limit is hit.
