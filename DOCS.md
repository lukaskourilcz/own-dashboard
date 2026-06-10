# Own Dashboard — Documentation

A single-user-or-couple personal dashboard. Tracks subscriptions, todos, streaks, finances, plans, books, daily mood, and important dates. Built for a person who wants one place that holds the whole picture of their life — and, optionally, a partner's life alongside it.

This document is the canonical reference for what the app does, how it's wired up, and what it *won't* do without further work.

---

## Contents

- [At a glance](#at-a-glance)
- [Features in detail](#features-in-detail)
- [Couples mode](#couples-mode)
- [Technical stack](#technical-stack)
- [Architecture](#architecture)
- [Database](#database)
- [Setup](#setup)
- [Development](#development)
- [Project layout](#project-layout)
- [Known limitations and deferred work](#known-limitations-and-deferred-work)

---

## At a glance

The app is a tab-based dashboard. After you sign in with Google, you land on **Overview** and can navigate to any of the panels below.

| Tab | What it tracks | Shortcut |
| --- | --- | --- |
| Overview | Hero card (greeting + ongoing event + at-risk streaks + nearest important date), 3 KPI cards, compact versions of every panel | `g o` |
| Calendar | Form to create Google Calendar events (with all-day + RRULE recurrence) and a 7-day agenda view | `g c` |
| Subscriptions | Pie-chart breakdown, currency conversion, soft-cancel, "renewals in 30 days" list | (`g`-then-`s` is taken by Streaks; use the tab) |
| Todos | Open + done todos with optional due dates; partner's open todos show under your own when paired | `g t` |
| Streaks | Daily-habit check-ins with 12-week heatmap, current vs best streak, optional reminder time | `g s` |
| Finances | Accounts (net worth), income/expense transactions, monthly bar chart, this-month category donut | `g f` |
| Plans | Long-horizon goals with timeline + kanban; optional "add to Google Calendar" tie-in | `g p` |
| Books | Daily page logging, per-author totals, progress vs target. Solo or co-write with partner | `g b` |
| Pulse | Daily 1-5 mood + one-line note; 30-day dual-line trend when paired | `g m` |
| Dates | Anniversaries, birthdays, deadlines with live countdowns; recurring yearly or monthly | `g d` |
| Couple | Send invites, accept/decline, configure what to share, unpair | `g u` |
| Settings | Language (Čeština / English), display currency, light/dark, and which sections show in the nav | sidebar gear |

A quick-add bar at the top of Overview routes by prefix — see [Quick-add](#quick-add-prefix-routing).

---

## Features in detail

### Overview tab

- **Today hero**: live-ticking greeting (good morning / afternoon / evening based on the current hour, ticking every 30 s), current time, today's date.
- **Ongoing event indicator**: if a Google Calendar event is happening right now, it pulses in the greeting row. Otherwise the row shows "Next: <event> in 14m" with a humanized countdown.
- **Nearest important date**: any anniversary/birthday/deadline within 60 days is surfaced under the greeting line ("🎂 Sarah's birthday in 12 days").
- **Three KPI tiles**: monthly subscription spend (in the chosen display currency), open-todo count, and longest active streak.
- **Three day-context lists**: today's calendar events, todos due today (or overdue), and streaks not yet checked today. At-risk streaks (where you'd lose a 2+ day run) are surfaced first with a "12-day streak at risk" amber label.
- **Compact panels grid**: small versions of Pulse, Subscriptions, Todos, Streaks, and Calendar, all editable inline.

The hero handles hydration timing carefully — server and client render identical markup until the clock hook (`src/lib/use-now.ts`) takes over on the client. No flash of "Loading…" because the underlying data is server-rendered.

### Pulse

Daily 1-5 mood (😞 Rough → 😄 Great) with an optional one-line note. One row per user per day, enforced by a `unique(user_id, log_date)` constraint.

- **Compact card** on Overview shows your current mood, your partner's, and prompts a one-tap pick if you haven't logged yet.
- **Full tab** adds a note editor, three stat tiles (check-in streak, your 14-day average, partner's 14-day average), and a dual-line 30-day trend chart.
- **Always shared** with the paired partner — there's no separate share toggle. The whole point of the feature is to surface "how each other is doing today."
- Quick-add: `!mood great`, `!mood 4`, or `!mood 5 finished the chapter` — accepts a 1-5 digit or a mood word (rough, meh, okay, fine, good, great, amazing, plus synonyms).

### Calendar

The dashboard does **not** store calendar events. It reads from and writes to the user's Google Calendar directly using the `provider_token` Supabase keeps on the session.

- **Week view** (right side of the Calendar tab): the next 7 days of events grouped by day with "Today" highlighted. Recurring events are tagged with a 🔁 icon.
- **Create event form** (left side):
  - Title, date, start, end, description
  - **All-day toggle**: hides time inputs and sends `start.date` + exclusive `end.date` (Google convention)
  - **Repeats**: Daily / Weekly / Monthly → translated to `RRULE:FREQ=...` strings
- **Expired-token handling**: if Google returns 401, the form, hero, and week view all show a **Re-link Google** button that re-runs OAuth with `prompt=consent` to refresh the token.

### Subscriptions

- **Original-currency storage** with **display-currency totals**. Each subscription has its own currency (USD, EUR, GBP, CZK, CAD). A static FX table in `src/lib/fx.ts` converts everything into a chosen display currency for totals and charts. The display-currency picker lives in the Spending overview card header.
- **Soft-cancel**: pause a subscription with `is_active = false`. Cancelled rows are excluded from totals and the pie chart, but still listed (strikethrough, dimmed, sorted to the bottom). Toggle back with the play button. Hard-delete via trash is also available.
- **Pie chart**: monthly cost breakdown, active subs only.
- **Renewals next 30 days** card: list sorted by `next_billing_date`, with cross-currency conversion hints when the sub's currency differs from your display currency.
- **Billing cycles**: monthly (identity), yearly (÷ 12), weekly (× 52/12).

### Todos

Open and done lists, optional due dates. The Overview compact card shows the 5 most recent open todos; the full tab shows everything with a delete action.

- **Optimistic toggle**: clicking the checkbox flips the state instantly, then writes to Supabase. Errors roll back.
- **Partner section** (when paired and the partner has shared todos): appears under your own list with a heart icon. Read-only — no checkbox or delete button, matching the "writes are own-only" RLS contract.

### Streaks

Daily habit tracking. Each streak is a named habit with a color. A "log" row records that you did the habit on a date.

- **12-week heatmap** (GitHub-style) on the full tab. Today is in the bottom-right; every cell has a date tooltip.
- **Compact mode** (Overview) uses a 7-day strip instead of the heatmap to fit the smaller card.
- **Current vs best**: the row shows "12 current · 47 best". Current walks back from today; best scans all history for the longest consecutive run.
- **Optional reminder time**: stored as a Postgres `time` value (e.g. `09:00`). No notification machinery is wired up yet — it's persisted so a future scheduler can pick it up.
- **Optimistic check-in**: marking today inserts a tentative row, swaps in the server's row on success, rolls back on error.
- **At-risk surfacing**: an unchecked streak with a 2+ day current run is promoted to the top of the Overview "streaks left today" section.
- **Partner section** (when paired): partner's streaks render below yours with their heatmap, but no "Mark today" button — they own their check-ins.
- Quick-add: `!streak Read 30 min` finds a streak by name (case-insensitive) and marks it for today.

### Finances

Two related concepts: **accounts** (where money lives) and **transactions** (where money moves).

- **Net worth tile**: sum of all account balances, converted into the display currency.
- **Inline-editable accounts**: click pencil → edit name + balance → save (optimistic, with server-fetch rollback on error).
- **Income / expense form**: kind toggle (red ↓ / green ↑), amount + currency, category, date, optional account link, optional note.
- **Monthly bar chart**: 6-month income-vs-expense.
- **This-month category donut**: groups expenses by category. The donut also folds **active subscriptions** in as a synthetic "Subscriptions" slice — so the user sees their real monthly outflow, not just what they manually logged. The synthetic slice respects the soft-cancel flag.
- **Recent transactions list**: 20 most recent, with delete action.

### Plans

Long-horizon goals separate from todos. Statuses: `idea / active / done / dropped`.

- **Two views, switchable**:
  - **Board**: 4 status columns, each card has a "change status" popover with the other three options.
  - **Timeline**: rows sorted by target date. Overdue rows go red. "in 3d" / "5d ago" relative hints. Status is changed via a tinted Select.
- **Optional Google Calendar tie-in**: tick "Add as an all-day Google Calendar event" on the form. The panel creates the plan first, then POSTs to `/api/calendar/event` and patches the returned `linked_calendar_event_id` back onto the plan row. If the calendar call fails (e.g. 401), the plan still saves and the user gets a nudge to re-link.

### Books

Co-author-friendly book tracking. Each book has a title, optional `target_pages`, and a `status`. Each daily page log is a row in `book_pages` with a unique constraint on `(book_id, user_id, log_date)`.

- **Per-author counters**: each book shows "Me / Partner" totals plus today's increment. Solo books just show your column.
- **Progress bar** against `target_pages` (if set).
- **14-day stacked bar chart**: who wrote how much each day.
- **Co-write toggle** on new-book form (visible when paired): flips `couple_id` on so both partners can log against the same book.
- **Logging is two-tier**: if you already logged today, the row's pages get incremented and the note merged; otherwise a new row inserts optimistically.
- Status: `active / paused / done`. Pausing or completing keeps the data; deletion cascades to page logs.

### Important Dates

Anniversaries, birthdays, deadlines.

- **Form**: title, date, optional emoji, recurring toggle (yearly or monthly), partner-share toggle, notes.
- **Coming up list**: sorted by next occurrence. Soon (≤ 7 days) rows highlight emerald; past one-offs fade out.
- **Recurrence math** (`src/lib/important-dates.ts`):
  - **Yearly**: returns this year's date if upcoming, next year's if already passed.
  - **Monthly**: clamps day-31 to month-end (so a "Rent on the 31st" date hits Feb 28, Apr 30, etc.). Leap-year-aware (Feb 29 in leap years).
  - **Years completed**: for yearly recurrences, displays "year N" so you know it's your 5th anniversary, not your 6th.
- **Overview hero pulls in** the next-upcoming date within 60 days, so anniversaries float to the top of consciousness on the front page.

### Couple

The pairing surface.

- **Solo state**: form to invite a partner's email, list of incoming invites (accept / decline), list of sent invites with status pills.
- **Paired state**: shows partner's display name + email, an **Unpair** button (with confirm), and a mirror of what they share with you.
- **Sharing toggles**: per-category (subscriptions, todos, streaks, finances, plans, books). Each toggle is optimistic, upserts a `sharing_prefs` row.
- The accept flow inserts a `couples` row with canonical sorted user ids (matching the unique constraint), then marks the invite `accepted`. `router.refresh()` reloads server context so the rest of the dashboard immediately reflects the new pairing.

### Settings & internationalization

A dedicated **Settings** tab (sidebar/mobile gear, always visible) holds the device-local preferences:

- **Language** — the whole app is bilingual **Czech (default) / English**. Translations live in `src/lib/i18n/`: one typed dictionary file per section under `sections/`, assembled in `index.ts`. Components read strings via `const t = useDict()` (`t.<section>.<key>`); dynamic strings are functions (`t.kpi.nDone(3)`). Czech completeness is guaranteed by the type system — every `cs` block must satisfy the same type as its `en` block, so a missing key is a compile error. Dates render through `useDateLocale()` (date-fns `cs`/`enUS`).
- **Display currency** — what every total/chart converts into; defaults to **CZK**. `formatCurrency` (`src/lib/utils.ts`) picks a native locale per currency code (e.g. CZK → `cs-CZ` → "1 234,56 Kč"), independent of UI language, so it's hydration-stable.
- **Appearance** — light/dark, sharing the existing `useTheme` store.
- **Navigation sections** — per-section show/hide toggles for the nav panel (Overview is always shown). The command palette still lists every section regardless, so hidden ones stay reachable by search.

All three new preferences (`lang`, `displayCurrency`, `hiddenNavSections`) persist in `localStorage` via the same `useSyncExternalStore` pattern as `useTheme` (`src/lib/i18n/lang.ts`, `src/lib/use-prefs.ts`). Language is applied pre-hydration by the bootstrap script in `layout.tsx` (sets `<html lang>`), mirroring the dark-mode bootstrap.

---

## Couples mode

### Pairing flow

1. User A invites by email. A `couple_invites` row is created with `inviter_id = A` and `invitee_email = B's email`.
2. User B signs in (or refreshes). RLS on `couple_invites` lets B see invites where `invitee_email = auth.jwt() ->> 'email'`. The Couple tab shows the pending invite.
3. B clicks **Accept**. The panel inserts a `couples` row (sorted user ids) and marks the invite `accepted`.
4. Both users now see each other's shared data on next render.

No email is actually sent on invite. The invitee discovers the invite when they next open the dashboard. (Real email invites would need Supabase Edge Functions or a third-party like Resend — see [Known limitations](#known-limitations-and-deferred-work).)

### Sharing preferences

Each user has a `sharing_prefs` row controlling which categories are visible to their partner. Defaults: everything off **except** `share_books = true` (books are the explicit couples feature).

| Category | What gets shared when on |
| --- | --- |
| `subscriptions` | Your active + inactive subs, totals, renewals |
| `todos` | Your open + done todos |
| `streaks` | Your streaks + their daily logs |
| `finances` | Your accounts + transactions |
| `plans` | Your long-horizon goals |
| `books` | Books with a matching `couple_id` (and book_pages on them) |

**Pulse** is intentionally shared whenever you're paired — no toggle, because the whole feature is "see how each other is doing today."

**Important dates**: per-row decision via the "Share with partner" checkbox at creation time.

### Where partner data shows up

Currently rendered in: **Todos**, **Streaks**, **Pulse**, **Books** (when co-written), **Important Dates** (when shared).

Currently **not** wired up: Subscriptions, Finances, Plans. The data is fetched by the server-side `loadPartnerSharedData` helper and reaches the shell, but the panel UIs don't yet render a "From <partner>" section for these three. The shape extends straightforwardly from the Todos/Streaks pattern (about 30 lines per panel).

### The RLS model

Every user table has its SELECT policy widened from "own only" to "own OR partner-shared":

```sql
create policy "todos select own or shared" on public.todos
  for select using (
    auth.uid() = user_id
    or public.is_shared_with_me(user_id, 'todos')
  );
```

`is_shared_with_me(target, category)` is a SECURITY DEFINER function that joins `couples` and `sharing_prefs` in one query. **Writes (INSERT / UPDATE / DELETE) are still "own only"** — a partner can never mutate your data.

To keep the existing panels from accidentally rendering partner rows mixed into their own data, every server-side fetch in `src/app/dashboard/page.tsx` explicitly filters by `user_id = current user`. Partner data flows through a separate, dedicated query path (`loadPartnerSharedData`).

---

## Technical stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router, Turbopack build) | Uses the new `proxy.ts` convention (renamed from `middleware.ts`) |
| Runtime | **React 19** | Uses `useSyncExternalStore`, class-based dark mode via Tailwind v4 |
| Styling | **Tailwind CSS v4** | CSS-first config (`@import "tailwindcss"`, `@custom-variant`), no `tailwind.config.js` |
| UI primitives | shadcn-style local components | `src/components/ui/*` — Card, Button, Input, Select, Tabs, Toast, Skeleton |
| Database & auth | **Supabase** (Postgres + Auth + RLS) | `@supabase/ssr` for cookie-based session handling |
| Charts | **Recharts** | Bar, Pie, Line — all server-data-driven, no client-fetched series |
| Icons | **lucide-react** | (Note: package is pinned to `^1.14.0` — confirm this is the intended package, since lucide-react ships on `0.x` upstream) |
| Dates | **date-fns** v4 | `format`, `subDays`, `differenceInCalendarDays`, etc. |
| Tests | **Vitest** 4 | 77 unit tests covering all lib modules; config in `vitest.config.mts` |
| Auth provider | Google OAuth (via Supabase) | Calendar scope: `auth/calendar.events`; `userinfo.email` + `userinfo.profile` |

The app does **not** depend on: an AI provider, a live FX API, an email service, an analytics SDK, an error tracker, a payment provider.

---

## Architecture

### Server vs client components

- **`src/app/dashboard/page.tsx`** is a Server Component. It does the heavy lifting: auth check, profile upsert, parallel data fetches (eight Supabase queries + two Google Calendar window fetches + couple context), and partner data load. Everything is awaited and passed down as props.
- **`src/components/dashboard-shell.tsx`** is a Client Component. It receives the server-rendered data, holds it as `useState`, and threads it through every panel. This is where tab state, keyboard shortcuts, display currency, and the calendar prefill nonce live.
- **Panels** (`src/components/panels/*.tsx`) are Client Components. They receive `items` + `setItems` props (controlled state) and own their forms, validation, and Supabase mutations.

The shell-lifts-everything pattern means the quick-add bar can mutate todos / streak_logs / pulses from one place without prop-drilling refs or using a global store.

### State management

There is no Redux, Zustand, or Context layer. State lives in `DashboardShell` via `useState` for each slice:

- `subscriptions`, `todos`, `streaks`, `streakLogs`, `accounts`, `transactions`, `plans`, `books`, `bookPages`, `pulses`, `importantDates` — all `useState<T[]>(initial...)`.
- Each panel receives both the array and the setter, so mutations bubble up naturally.

Display currency, current tab, and calendar prefill nonce are also shell-level state.

The clock (`useNow`) and theme (`useTheme`) use `useSyncExternalStore` for module-singleton stores — that's the React 19 pattern that satisfies the new no-impure-calls and no-setState-in-effect rules.

### Optimistic updates

All mutations follow the same shape:

```ts
// 1. Apply locally (optimistic)
setItems((prev) => prev.map(...));
// 2. Write to Supabase
const { error } = await supabase.from(...).update(...);
// 3. Roll back on error
if (error) {
  setItems((prev) => prev.map(... back to before ...));
  toast.err(error.message);
}
```

For inserts that need a tentative id (before the server returns the real one), the pattern uses a **module-level counter** for the tentative id:

```ts
let tentativeStreakLogCounter = 0;
// inside the handler:
const tentativeId = `tmp-${++tentativeStreakLogCounter}`;
```

This dodges React 19's no-impure-calls rule, which would flag `Date.now()` and `crypto.randomUUID()` inside a component function body even though those are only called in event handlers.

### Quick-add prefix routing

The Overview quick-add bar parses the first word of input:

| Prefix | Effect |
| --- | --- |
| `!todo <title>` | Inserts a todo |
| `!streak <name>` | Marks the named streak for today (case-insensitive; tolerates already-done) |
| `!cal <title>` | Switches to Calendar tab with the title prefilled |
| `!mood <level>` | Logs Pulse (level can be `1-5` or `rough/meh/okay/good/great` + synonyms) |

Errors and successes surface as toasts.

### Keyboard shortcuts

Gmail / vim-style two-key chords on the shell (`src/components/dashboard-shell.tsx`):

| Chord | Action |
| --- | --- |
| `g o` | Overview |
| `g c` | Calendar |
| `g s` | Streaks |
| `g t` | Todos |
| `g f` | Finances |
| `g p` | Plans |
| `g u` | Couple |
| `g b` | Books |
| `g m` | Pulse |
| `g d` | Dates |
| `n` | Focus the quick-add input (jumps to Overview first if you're elsewhere) |

The chord window is 1.5 s. Inputs, textareas, and selects are ignored so typing in a form doesn't trigger navigation.

### Theming and dark mode

Class-based (`<html class="dark">`) via Tailwind v4's `@custom-variant dark (&:where(.dark, .dark *))`. A tiny synchronous script in `<head>` (`src/app/layout.tsx`) reads `localStorage.theme` or `prefers-color-scheme` and sets the class before React hydrates — no flash of incorrect theme.

`useTheme` (`src/lib/use-theme.ts`) uses `useSyncExternalStore` so the toggle stays in sync with the DOM class even if something else writes to it.

### Toast system

A single `ToastProvider` (`src/components/ui/toast.tsx`) wraps the shell. The hook is `useToast()` and exposes `{ push, ok, err, info }`. Currently consumed by the quick-add bar; other panels still use inline error/success text and would migrate incrementally.

---

## Database

### Tables

All tables have RLS enabled. Every column is described inline in `supabase/schema.sql` — this is a summary.

| Table | Purpose | Cross-user visibility |
| --- | --- | --- |
| `subscriptions` | Recurring spending; FX-aware; soft-cancel via `is_active` | Partner read if `share_subscriptions = true` |
| `todos` | Tasks with optional due date | Partner read if `share_todos = true` |
| `streaks` | Named habits with color + optional reminder time | Partner read if `share_streaks = true` |
| `streak_logs` | One row per streak per day; unique constraint | Partner read if `share_streaks = true` |
| `accounts` | Bank/credit/savings accounts with balance | Partner read if `share_finances = true` |
| `transactions` | Income/expense rows; indexed on `(user_id, occurred_on desc)` | Partner read if `share_finances = true` |
| `plans` | Long-horizon goals; optional `linked_calendar_event_id` | Partner read if `share_plans = true` |
| `profiles` | Mirror of `auth.users` (display name + avatar) | Always readable by paired partner |
| `couples` | The pairing row (`user_a_id` + `user_b_id`, sorted) | Visible to both members |
| `couple_invites` | Pending / accepted / declined invites | Sender sees their sent; recipient sees invites for their email |
| `sharing_prefs` | Per-user per-category opt-in toggles | Always readable by paired partner |
| `books` | Books being written; optional `couple_id` for co-authoring | Owner, couple member, or `share_books = true` |
| `book_pages` | Daily page log per author per book; unique on `(book_id, user_id, log_date)` | Same as parent book |
| `daily_pulse` | Daily 1-5 mood + note; unique on `(user_id, log_date)` | Always readable by paired partner |
| `important_dates` | Anniversaries / birthdays / deadlines | Owner or couple member (when `couple_id` is set) |

### RLS model

Two-layer policies on every user table:

- **SELECT** policy: `auth.uid() = user_id OR <partner-shared>`. The partner-shared check goes through `is_shared_with_me(user_id, '<category>')`, a SECURITY DEFINER SQL function that joins `couples` and `sharing_prefs` in one query.
- **INSERT / UPDATE / DELETE** policies: `auth.uid() = user_id` — own data only. A partner can never write your data, even if you share it with them.

The two exceptions:

- **Books** and **book_pages**: when a book has a `couple_id` set, both partners can UPDATE the book (e.g. mark it done) — but only the row's own author can log a page for themselves.
- **Important dates**: same — either partner can edit a shared row.

### Migration strategy

`supabase/schema.sql` is the single source of truth and is **idempotent** — every block uses `if not exists` / `drop policy if exists ... create policy ...` / `create or replace function`. Safe to re-run on an existing project after pulling new code; new tables and policies are added incrementally without dropping existing data.

When new columns are added to existing tables (e.g. `is_active`, `reminder_time`), the file uses `alter table ... add column if not exists` so the migration is portable between fresh and existing installs.

---

## Setup

For full deploy instructions (Supabase + Google OAuth + Vercel) see the step-by-step in the project's most recent chat / `README.md`. The condensed version:

1. **Supabase**: create a project, copy `Project URL` + `anon public` key. In SQL Editor, run `supabase/schema.sql`. In Authentication → URL Configuration, set the Site URL and add redirect URLs for both `http://localhost:3000/auth/callback` and your eventual production URL.
2. **Google Cloud**: create a project, enable the **Google Calendar API**, configure the OAuth consent screen (scopes: `calendar.events`, `userinfo.email`, `userinfo.profile`), create an OAuth client (Web), and paste the **Supabase callback URL** (`https://<project>.supabase.co/auth/v1/callback`) as the authorized redirect URI.
3. **Wire Google into Supabase**: Authentication → Providers → Google → paste Client ID + Secret.
4. **Local `.env.local`**:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
   ```
5. **Vercel**: import the repo, set production branch, add the two env vars, deploy. After deploy, add the Vercel domain to Supabase's Site URL + Redirect URLs.

### What you don't need

- **No AI API key** — the app has no LLM calls.
- **No live FX API** — `src/lib/fx.ts` uses a hard-coded rate table with a TODO for live rates.
- **No email/SMTP** — couple invites are surfaced in-app on the partner's next page load. Real email invites would need Supabase Edge Functions or Resend.
- **No payments, analytics, or error tracker**.

---

## Development

### Scripts

```
npm run dev         # Next.js dev server (Turbopack)
npm run build       # production build
npm run start       # serve the production build
npm run lint        # ESLint (using eslint-config-next)
npm test            # Vitest, one-shot
npm run test:watch  # Vitest in watch mode
```

### Tests

77 unit tests live under `tests/lib/`, covering every pure module:

| Module | Tests | Catches |
| --- | --- | --- |
| `fx` | 6 | identity, unknown-currency passthrough, cross-pivot EUR→GBP |
| `subscriptions` | 11 | monthly/yearly/weekly conversion, FX mixing, pre-migration `is_active`, renewal window |
| `streaks` | 15 | today-missing → 0, gap stops, bestStreak across gaps, at-risk count from yesterday |
| `important-dates` | 13 | yearly rollover, day-31 → Feb 28 / Feb 29 clamping in leap years, non-recurring preservation |
| `pulse` | 12 | streak from today, trend null-filling, averageMood window |
| `finances` | 11 | net worth across currencies, monthly bucketing, "Subscriptions" synthetic slice |
| `couple` | 8 | per-category flag, null prefs → false |

Time-dependent tests pin the clock to `2026-05-12` with `vi.useFakeTimers()` so results don't drift with the system date.

**Not currently tested** (deferred):

- **React components** — would need `@testing-library/react` + `jsdom` + a Supabase client mock.
- **RLS policies** — the most security-critical piece; testing properly needs a real Supabase instance (local CLI or a test project).
- **Google Calendar fetch** — `src/lib/calendar.ts`'s `fetch()` calls are not mocked.
- **End-to-end** — no Playwright suite.

---

## Project layout

```
src/
  app/
    api/calendar/event/route.ts   POST → create Google Calendar event
    auth/callback/route.ts        OAuth code exchange
    auth/signout/route.ts         POST → sign out
    dashboard/
      page.tsx                    server-side data load (8 Supabase + 2 Google Calendar)
      loading.tsx                 Suspense fallback (skeleton grid)
    login/page.tsx                Google sign-in
    layout.tsx                    fonts, dark-mode bootstrap script
    globals.css                   Tailwind v4 + dark variant
  components/
    dashboard-shell.tsx           tab state, keyboard shortcuts, lifted data, ToastProvider
    theme-toggle.tsx              header light/dark toggle
    calendar/
      relink-cta.tsx              "Re-link Google" button used in 3 places
      week-view.tsx               7-day agenda card
    overview/
      today-hero.tsx              greeting + KPIs + day context
      kpi-cards.tsx               3 summary tiles
      quick-add.tsx               !todo / !streak / !cal / !mood input
    panels/
      subscriptions-panel.tsx
      todos-panel.tsx
      streaks-panel.tsx
      streak-heatmap.tsx
      finances-panel.tsx
      plans-panel.tsx
      books-panel.tsx
      pulse-panel.tsx
      important-dates-panel.tsx
      couple-panel.tsx
      calendar-panel.tsx
    ui/                           shadcn-style primitives + Skeleton + Toast
  lib/
    supabase/
      server.ts                   Server Component / Route Handler client
      client.ts                   Client Component client
      middleware.ts               session refresher (called from proxy.ts)
    calendar.ts                   server-side Google Calendar window fetch
    couple.ts                     loadCoupleContext, loadPartnerSharedData
    finances.ts                   netWorth, monthlyTotals, expenseByCategory
    fx.ts                         static FX rates + convert()
    google-auth.ts                relinkGoogle (signInWithOAuth wrapper)
    important-dates.ts            nextOccurrence + buildOccurrences
    pulse.ts                      mood meta, streak, trend, average
    streaks.ts                    computeStreak, bestStreak, unchecked, etc.
    subscriptions.ts              toMonthly, totals, upcomingRenewals
    types.ts                      all DB row types
    use-now.ts                    ticking clock via useSyncExternalStore
    use-theme.ts                  theme hook (class-based dark mode)
    utils.ts                      cn, formatCurrency
  proxy.ts                        Next 16 proxy convention (session refresh)
supabase/schema.sql               full DB schema + RLS (idempotent)
tests/lib/                        77 Vitest tests
vitest.config.mts                 Vitest config (.mts because Vitest 4 needs ESM-loaded config)
```

---

## Known limitations and deferred work

The following items are intentionally scoped out. Each is small enough to ship as a focused commit if you decide it matters.

- **Partner data in Subscriptions / Finances / Plans**. The data flows through `partnerData` server-side, but the three panels don't yet render a "From <partner>" section. The pattern proven in Todos and Streaks extends directly (about 30 lines per panel).
- **"Us" stats card on Overview**. Planned: days paired, books co-written, pages-together total, days both checked in. All deriveable from existing data with no new schema; just a small component drop-in.
- **Email invites**. Couple invites currently surface in-app on the partner's next load. Real email send needs either Supabase Edge Functions + a transactional email API, or a server-route handler that calls Resend / Postmark / SES.
- **Subscription / Books / etc. toast migration**. Toast is wired up via `ToastProvider` but only quick-add currently uses it. Remaining panels still have inline error/success text and can migrate incrementally.
- **Edit a streak's reminder time** or **flip a book between solo and co-write after creation** — these are creation-time only right now. Inline-edit UI is the missing piece.
- **Live FX rates**. `src/lib/fx.ts` carries a hard-coded snapshot. The function signature is set up to swap in a live API (e.g. Frankfurter, open.er-api.com) without touching call sites.
- **Calendar-event editing/deletion**. The form creates events; it doesn't edit or delete. The week view shows events read-only with a deep link to Google Calendar.
- **Notifications for streak reminders**. `streaks.reminder_time` is persisted but no scheduler reads it. A future Supabase Edge Function with `pg_cron` could send web push / email notifications.
- **Component tests + RLS tests + E2E**. Lib coverage is solid (77 tests); the React tree and the database policies aren't tested. RTL + jsdom for components, a seeded Supabase instance for RLS, and Playwright for E2E are all sensible next layers.
- **Refresh tokens for Google Calendar**. The app uses Supabase's `provider_token` which expires ~1 hour. The Re-link button handles recovery, but if you want background work against the calendar, you'd need to capture `provider_refresh_token` server-side on OAuth callback and exchange it manually.
- **Mobile polish**. Layout is mostly responsive but the tab strip will overflow on very narrow screens; a bottom-nav variant on mobile would feel native. The current behavior is horizontal-scroll, which works but isn't pretty.

---

## Acknowledgements

Built incrementally across several pairing sessions with an assistant. Each major section landed in its own commit so the history can be cherry-picked or rolled back per feature:

| Theme | Commits |
| --- | --- |
| Overview, KPIs, quick-add, bonus polish (live "now", at-risk streaks) | `847a925`, `f6f782e` |
| Subscriptions polish (FX, soft-cancel, renewals) | `255625e` |
| Streaks polish (heatmap, best vs current, reminder time) | `0c48129` |
| Calendar upgrade (week view, RRULE, all-day, 401 handling) | `8aab45e` |
| Finances panel | `3b42d7d` |
| Plans panel | `4d52f18` |
| Cross-cutting (dark mode, toasts, skeletons, shortcuts) | `d21b9cf` |
| Couples mode infrastructure + UI + partner data | `605e58e`, `e1ef31d`, `d0aebbf`, `32b3184` |
| Pulse, Important Dates | `927411b`, `1b002b7` |
| Vitest + 77 lib tests | `793bca6` |
