# Own Dashboard

Personal life dashboard — subscriptions, todos, streaks, finances, Czech invoices, books, calendar, notes.

- **Now:** ~$0/month — Vercel Hobby + Supabase Free + Anthropic pay-as-you-go, at 1–2 users.
- **Stack:** Next.js on Vercel · Supabase (Postgres + Auth) · Anthropic · Resend · Sentry · Google/GitHub APIs.
- **First ceiling:** Vercel's non-commercial Hobby clause and Supabase's 7-day auto-pause — both block going live before any quota does.
- **At 100 users:** ~$45–70/month — Vercel Pro ($20) + Supabase Pro ($25, kills auto-pause + adds backups) + Anthropic (~$10–25).
- **At 1,000 users:** ~$150–250/month — add a Postgres read replica + Supavisor pooling, prompt caching on quick-add, and a real job queue for notifications.
- **Watch:** Anthropic tokens and Postgres connections — the two costs that grow with usage, not a flat free tier.
