# OwnDashboard — cost and scaling

Personal professional operating system for projects, clients, career, money, planning, and knowledge. Pricing checked **2026-07-21**; taxes, domains, currency conversion, and any existing account-specific contracts are excluded. The technology stack is documented in `about-project.md`; this file covers cost and scaling only.

## What it costs now

The repository cannot see the owner's live billing pages, so the exact current invoice must be verified in each provider console. Based on the configured architecture:

| Operating mode | Fixed platform cost | Variable cost | Practical total |
| --- | ---: | ---: | ---: |
| Local/development | $0 | $0 unless external APIs are called | **$0/month** |
| Personal production on free tiers | $0 | Anthropic usage; optional domain | **$0 + AI usage/month** |
| Reliable always-on personal production | Supabase Pro $25; Vercel Hobby $0 while use remains personal/non-commercial | Usually low AI usage | **about $25–40/month** |

Free-tier production means [Vercel Hobby](https://vercel.com/pricing) plus [Supabase Free](https://supabase.com/pricing). Supabase Free currently includes 500 MB database storage and may pause after a week without activity; Pro starts at $25/month, includes $10 of compute credit, 8 GB disk, daily backups, and does not pause. Vercel Pro starts at $20/month and includes a $20 usage credit, but OwnDashboard does not need Pro solely because it is deployed—it is intentionally personal and non-commercial.

AI is the main true pay-as-you-go line item. The defaults use a Haiku-class model for routing/enrichment and a Sonnet-class model for synthesis. Current official [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) is $1/M input + $5/M output tokens for Claude Haiku 4.5 and $3/M input + $15/M output tokens for Claude Sonnet 4.5. A light personal workload is commonly only a few dollars, but long project notes, repository documents, or repeated copilots can make it higher. Set provider budget alerts rather than relying on this estimate.

Generated-media tooling is not part of the deployed runtime stack. Before incurring any cost, a future agent must research at least three current low-cost or free providers and document price/free quota, output rights, watermark, privacy/retention, formats, and credential requirements. Any selected generator cost is a one-off design-production expense, not part of OwnDashboard's monthly operating total.

## Optional service allowances

| Service | Free/current entry point | First likely paid step |
| --- | --- | --- |
| Resend | 3,000 emails/month and 100/day | Pro $20/month for 50,000 emails; see [Resend pricing](https://resend.com/pricing) |
| Upstash Redis | 500,000 commands/month, 256 MB | Pay-as-you-go at $0.20/100k commands or fixed plans from $10; see [Upstash pricing](https://upstash.com/pricing) |
| PostHog | First 1M product events/month, 5k recordings, and 1M flag requests are free | Metered beyond those allowances; see [PostHog pricing](https://posthog.com/pricing) |
| Sentry | Developer tier: 1 user, 5k errors, 50 replays, plus included traces/logs | Team starts at $26/month billed annually; see [Sentry pricing](https://sentry.io/pricing/) |
| Google Calendar API | Standard API usage has no additional charge under current quotas | Quota review rather than a normal monthly bill; see [Calendar usage limits](https://developers.google.com/calendar/api/guides/quota) |
| GoCardless Bank Account Data | Account/contract specific; public product pages do not establish a universal free allowance | Verify the owner's Bank Account Data agreement before treating it as $0 |
| GitHub OAuth/API | No separate application line item in the current design | GitHub plan/repository charges remain outside OwnDashboard |

## Growth scenarios

OwnDashboard is not multi-tenant today. The user-count scenarios below are capacity exercises, not a claim that creating public accounts is safe; public use would first require product, abuse-prevention, privacy, support, and operations work.

| Scenario | Estimated monthly total | What changes |
| --- | ---: | --- |
| 1 active owner | **$0–40** | Free tiers or Supabase Pro; AI usage determines the range |
| 100 active users | **$65–145** | Vercel Pro $20 + Supabase Pro $25 + roughly $20–100 AI; email, Redis, analytics, and monitoring can usually remain within free allowances |
| 1,000 active users | **$95–550+** | Vercel Pro, Supabase Pro with compute upgraded only if measurements require it, roughly $50–400 AI, possibly Resend Pro, Upstash, and Sentry Team |

These are planning bands, not quotes. AI prompt size and call frequency can move the upper bound dramatically; a low-AI workload can stay near the bottom. Supabase's published compute prices currently range from Micro $10/month (covered by the Pro compute credit) through Small $15, Medium $60, and higher. A Medium database on Pro is roughly $75/month total after the included $10 compute credit—not automatically required at any user count.

## First ceilings and upgrade triggers

1. **Supabase Free reliability/storage** is the first predictable personal-production ceiling: inactivity pausing, 500 MB database storage, and limited backup guarantees. Upgrade to Pro for always-on behavior/backups, not because an arbitrary user count was reached.
2. **Anthropic spend/context size** grows with every AI request. Track calls by workflow and model, keep context bounded, use Haiku for classification, reserve Sonnet for synthesis, and introduce prompt caching only after measuring repeated context.
3. **Database compute and connections** should drive Supabase upgrades. Watch p95 query time, CPU, memory, database size, and connection saturation; optimize queries/indexes before selecting larger compute or replicas.
4. **Vercel function duration and transfer** matter for PDF parsing, GitHub/Google calls, scraping, and AI streams. Move work to a durable queue only when jobs outlive request limits or need reliable retries—cron count alone is not a reason.
5. **Email and observability volume** become paid only after their generous free allowances. Configure hard billing limits in PostHog/Sentry and a Resend daily/monthly cap.
6. **Agent queue age and failure rate** are the VPS automation signals. Track oldest queued age, running-task duration, and failed outcomes; add heartbeats/leases and retry policy only after real unattended execution requires them.
7. **Daily focus history** is intentionally tiny: at most seven snapshot rows per generation. Candidates come from GLOBAL work and active projects, with NEEDED.md tasks mapped by repository when needed. If manual regeneration becomes unusually frequent, retain only the best/completed generation per old date after measuring table growth; do not discard the current audit trail pre-emptively.

## Scaling architecture when measurements justify it

- Keep route-scoped React Query loads and bounded result limits; add pagination before increasing database compute.
- Add indexes from real slow-query evidence and keep explicit RLS/grants on every new table.
- Use Upstash for distributed throttling once multiple serverless instances make the in-memory fallback insufficient.
- Add a durable queue for bank sync, scraping, notification delivery, and long AI work only when retries/concurrency are operational requirements.
- The current agent queue is durable and uses `FOR UPDATE SKIP LOCKED`, so multiple VPS workers cannot claim the same row. It deliberately has no automatic retry or arbitrary command transport; add leases, capability routing, and bounded retries only from measured worker needs.
- Add read replicas only for demonstrated read pressure and replica-safe workloads; they are not a default 1,000-user requirement.
- Preserve the current static FX model unless the product explicitly accepts the cost, reliability, and audit implications of live rates.

## Cost controls to configure

- Anthropic monthly spend limit and alert thresholds
- Vercel usage alerts and function/transfer review
- Supabase database-size, compute, and egress alerts
- PostHog and Sentry billing caps
- Resend sending limits and suppression monitoring
- Upstash command/throughput alerts

The two numbers worth watching first are **Anthropic tokens per workflow** and **Supabase database/compute utilization**. They scale with real usage; most other services can remain at $0 for a personal installation.
