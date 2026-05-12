# Own Dashboard

A personal-or-couple dashboard. Subscriptions, todos, streaks, finances, plans, books, mood check-ins, anniversaries, and a Google Calendar tie-in — all in one place. Built with Next.js 16, Supabase, Tailwind v4, and Recharts.

📖 **For the full feature list, architecture, and database model see [DOCS.md](./DOCS.md).**

## Features

- **Login** via Google (Supabase Auth) with Calendar scopes
- **Calendar form** — pick a date, time, and description; the event is created on your primary Google Calendar
- **Subscriptions panel** — add / edit / delete, pie chart breakdown, monthly + yearly totals
- **Todos** — minimal add form, mark done, delete
- **Streaks** — track skills daily, see the last 14 days at a glance and your current streak

All data lives in your own Supabase Postgres with Row Level Security so only you can read your records.

## Setup

### 1. Install

```bash
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. In **SQL editor**, run the contents of [`supabase/schema.sql`](./supabase/schema.sql). This creates the four tables (`subscriptions`, `todos`, `streaks`, `streak_logs`) with RLS policies that scope rows to `auth.uid()`.
3. In **Project Settings → API**, copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 3. Configure Google OAuth

1. In Google Cloud Console: create a project, enable the **Google Calendar API**, then create an **OAuth 2.0 Client ID** (Web application).
2. Add an authorized redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback` (your Supabase Auth callback).
3. Add scopes: `.../auth/calendar.events`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
4. In Supabase **Authentication → Providers → Google**: enable it and paste the Client ID + Client Secret.
5. In Supabase **Authentication → URL Configuration**: set the site URL (e.g. `http://localhost:3000` for dev) and any additional redirect URLs (e.g. `http://localhost:3000/auth/callback`).

### 4. Environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

### 5. Run

```bash
npm run dev
```

Open <http://localhost:3000>.

## Notes on Google Calendar

The Calendar API call uses the `provider_token` Supabase keeps on the session. If you see a "Google access token not available" message, sign out and sign in again — that refreshes the provider token. Long-lived offline refresh tokens are out of scope for this starter; if you want the token to persist beyond ~1 hour, store the `provider_refresh_token` from the OAuth response and exchange it on the server.

## Project layout

```
src/
  app/
    api/calendar/event/   POST → creates Google Calendar event
    auth/callback/        OAuth callback
    auth/signout/         POST → sign out
    dashboard/            authenticated dashboard
    login/                Google sign-in
  components/
    panels/               subscriptions / todos / streaks / calendar
    ui/                   shadcn-style primitives
  lib/
    supabase/             browser + server clients, middleware helper
    types.ts              shared row types
    utils.ts              cn(), formatCurrency()
  middleware.ts           auth guard
supabase/schema.sql       database schema with RLS
```
