# Notes — lukaskourilcz/own-dashboard

> Historical implementation log. For the current product, rollout, architecture,
> and outstanding owner actions use `README.md`, `DOCS.md`, `NEEDED.md`, and
> `stack-and-scaling.md`; those files are authoritative when older entries below
> describe superseded navigation or setup steps.

> **Status legend:** ~~struck-through~~ = done. Open bullets = still to do.
> Each finished item has a short **Done:** note describing what shipped and
> where, plus any deviation from the original ask.

---

## Completed

### ~~1. Plans: recurring plans + dashboard tracker~~
> Redesign the section 'Plans' so for each Plan I can choose if this is a weekly,
> biweekly or monthly reoccuring plan for each plan I add there. Once the plan is
> in place, i want to show on Dashboard which plans are still needed to be done
> until the end of the reoccurence with the options to mark them as done. This
> should be a motivator for me to always see which plans I have there and how
> much left I have before the end of the loop.

**Done.**
- New per-plan **Repeat** field (One-off / Weekly / Every 2 weeks / Monthly) in
  the Plans "New plan" form. A recurrence chip now shows on each board card and
  timeline row. (`src/components/panels/plans-panel.tsx`)
- Data model: `recurrence` + `last_completed_at` columns added to `plans`
  (`supabase/schema.sql`, with `add column if not exists` migration for existing
  installs). `Plan` type + `PlanRecurrence` added in `src/lib/types.ts`.
- Period logic lives in `src/lib/plan-recurrence.ts` (pure, unit-tested in
  `tests/lib/plan-recurrence.test.ts`). Weekly/biweekly windows are
  Monday-aligned; biweekly fortnights tile from a fixed epoch; monthly = calendar
  month. "Done this period" is derived from `last_completed_at` falling inside
  the current window, so it auto-resets when the next loop starts (no per-period
  rows needed).
- **Dashboard:** a new **"Recurring plans"** overview widget shows every active
  recurring plan, its cadence, **days left in the period** (the motivator), and a
  one-tap circular checkbox to mark done / undo. Pending items sort first
  (soonest deadline first); when all are done it shows an "All done for now 🎉"
  banner. (`src/components/overview/recurring-plans.tsx`, wired in
  `src/components/dashboard-shell.tsx`.)

**Deviations / things to know:**
- The tracker is a **separate overview widget** (id `plans`) rather than baked
  into the Plans page itself — matches the existing customizable dashboard
  pattern. It's in the default layout, so **new** users see it automatically;
  **existing** users with a saved custom layout must add it once via
  *Customize → Add widget*.
- Recurring plans with status `dropped` or `done` are treated as retired and
  excluded from the tracker. `idea`/`active` recurring plans are shown.
- Follow-up: a recurring plan has no single end date, so the **Target date**
  field and the one-off **Add to calendar** checkbox are hidden (and cleared)
  whenever a recurrence is selected — only one-off plans show them.

### ~~2. GitHub notes: textarea → saved card~~
> When the new note in /github section is added, I want it to change from text
> area to a small card with two action buttons for edit and delete. This way the
> user has a feeling that it is actually saved here. Also, make sure the card has
> some max height and it truncates the text rather than making the cards bigger
> higher than the max.

**Done.** In `src/components/panels/repos-panel.tsx` (`RepoNoteEntry`):
- A saved note now renders as a compact **card** with **edit** (pencil) and
  **delete** (trash) buttons. Text is truncated with `line-clamp-6` so the card
  never grows past ~6 lines.
- A freshly added (empty) note opens straight into the textarea; pressing
  **Done** (or blurring) collapses it into the saved card. Edit reopens the
  textarea. Autosave-on-debounce behaviour is preserved.

### ~~3. Don't reorder repos when sending notes to GitHub~~
> also, when I send the notes to Github, dont reorder the repos on the board.

**Done.** Added `touchRepoInCache()` in `src/lib/github-queries.ts` — it refreshes
the repo's `pushed_at` **without re-sorting** the list. `saveToGithub` now calls
that instead of `bumpRepoInCache` (which sorted the just-saved repo to the top).
Order stays stable.

**Note:** the "Write file" dialog (arbitrary commits) still uses the original
`bumpRepoInCache` (intentional reorder) — only the notes-save path was changed,
matching the request. A later background refetch from GitHub will reflect the
repo's real `pushed_at` order, but there's no more jump on save.

### ~~4. "Save to GitHub": confirm file created + clear local notes~~
> When I hit the button Ulozit na Github, I want the user to know that the .md
> file on GitHub was created and I want to delete the notes from here.

**Done.** In `saveToGithub` (`src/components/panels/repos-panel.tsx`): after a
successful push, the repo's `repo_notes` rows are deleted (DB + local store +
cache) so the card returns to its empty state, and a confirmation toast
(`notesSavedCleared`) tells the user the file was created on GitHub and the notes
were cleared.

**Decision:** clearing happens **automatically** on every successful push (owner's
choice). If the post-push delete fails, the push is still reported as saved and
the notes are left in place.

### ~~5. AI links: researched & ranked resource catalogue~~
> Go to the AI links section and search the internet for great AI related
> websites - I want a list of sites that use AI for design, or for any free
> APIs, for any components, literally for anything that can improve my projects
> that I am creating using Claude Code. Everything from hosting / design /
> performance / data, etc. Rank each site 1–5 and drop anything scoring 1–2.

**Done.** Researched ~60 candidate sites (July 2026) across AI design,
components, free APIs/data, hosting/backend, performance/monitoring, Claude
Code/MCP, security and inspiration; kept the 48 that scored 3+/5 (after
trimming, everything kept is a 4 or 5).

- Delivered as **`supabase/seed-ai-links.sql`** — the AI links data is per-user
  in Supabase (RLS), so it can't be committed as app data. Run the script once
  in the Supabase SQL Editor (see `NEEDED.md` §0) and the links appear in the
  AI section, grouped into 8 categories (AI DESIGN, COMPONENTS & UI, FREE APIS
  & DATA, HOSTING & BACKEND, PERFORMANCE & MONITORING, CLAUDE CODE & MCP,
  SECURITY, INSPIRATION), each description prefixed with its score (`5/5 · …`).
- **Idempotent:** categories are reused by name (case-insensitive), links are
  deduped by URL (scheme/`www.`/trailing-slash-insensitive) against the whole
  existing collection, and `created_at` is staggered per rank so the
  best-scored links render first (the panel sorts newest-first).
- **Verified** on a local Postgres 16 with the repo's real `ai_*` DDL + RLS and
  a stubbed `auth.users`: fresh run inserted 46/48 (two deliberately
  pre-existing URLs — one an `http://www.` variant — were correctly skipped),
  re-run inserted 0, category `SECURITY` was reused rather than duplicated.

**Deviations / things to know:**
- Scored but **excluded** (1–2/5 or redundant next to a kept site): Railway &
  Fly.io (free tiers effectively gone), Netlify (credit-based now, and Vercel
  already covers it), JSONPlaceholder (superseded by DummyJSON), mcp.so
  (redundant vs Smithery/PulseMCP), Uizard/Magic Patterns/Krea (weaker fit
  than v0/Stitch/Recraft), publicapis.io-style SEO clones, and self-ranking
  "best AI tool" sites (Komposo, AIDesigner) that couldn't be independently
  verified.
- Already-integrated services (Vercel, Supabase, Sentry, PostHog, Lucide) were
  left out on purpose — the list is for things the projects don't have yet.
- No app code changed in this item; it's data (seed SQL) + docs only.

### ~~6. AI links: Flux + Seedream, AI IMAGES category, cost labels~~
> Tell me what Flux and Seedream do and add them there too. I need more design
> tools like these too. Also, for every AI link, add a subsection with COST
> info — which are free, which are paid, and paid-with-free-tier.

**Done.** `supabase/seed-ai-links.sql` is now v2 (56 links, 9 categories):

- New **AI IMAGES** category with 8 ranked links: FLUX / Black Forest Labs
  (5/5), Midjourney (5/5), fal.ai (5/5), Seedream via Dreamina (4/5), Reve
  (4/5), Krea (4/5), Leonardo AI (4/5), Replicate (4/5).
- **Cost labels on every link** — descriptions are now
  `score · cost · what it is`, with cost one of: `Free`,
  `Free (open source)`, `Free tier + paid`, `Pay-per-use`, `Paid`.
- **Upgrade-aware idempotency:** re-running the seed refreshes descriptions of
  rows the seed itself wrote earlier (matched by URL + the `n/5 ·` description
  prefix) so v1 rows pick up cost labels; user-authored links are never
  modified. Verified on local Postgres 16: fresh run = 54 inserted / 0
  refreshed (2 personal fixtures skipped); v1→v2 run = 8 inserted / 48
  refreshed; re-run = 0 / 0.

**Deviations / things to know:**
- "Subsection with cost info" is implemented as a label inside each link
  description (`4/5 · Free tier + paid · …`) — the `ai_links` schema has no
  extra field for it, and this keeps it visible on every card with no app code
  change. *(Superseded by item 7: pricing is now a structured column with a
  colored badge.)*
- Reve's official domain was verified as `reve.com` (redirects to
  `app.reve.com`); several lookalike sites (reve2.app, reve-ai.art) are clones
  and were avoided.

### ~~7. AI links: pricing as a colored badge, out of the description~~
> I want each link to have the pricing somewhere else than combined in the
> description, nicely categorized + make the pricing a different color than
> the description (free = green, free tier + paid = yellow, paid = red).

**Done.**
- **Data model:** new nullable `ai_links.pricing` column constrained to
  `'free' | 'freemium' | 'paid'` (`supabase/schema.sql`, with the usual
  `add column if not exists` migration). `AiPricing` type added in
  `src/lib/types.ts`.
- **UI (`src/components/panels/ai-panel.tsx`):** `PricingBadge` pill rendered
  next to each link's host — green `success`, yellow `warning`, red
  `destructive` tokens (10/30 alpha backgrounds/borders, same recipe as the
  invoices `StatusBadge`, works in light + dark). The add/edit dialog has a
  **Pricing** select (Not set / Free / Free tier + paid / Paid) beside
  Category; create/update mutations persist it.
- **i18n:** `pricing`, `pricingNone`, `pricingLabel.{free,freemium,paid}` in
  EN + CS (`src/lib/i18n/sections/ai.ts`).
- **Seed v3 (`supabase/seed-ai-links.sql`):** self-migrates the column, then
  moves the cost out of every seed-authored description into `pricing`
  (23 free · 30 freemium · 3 paid across the 56 links). Verified on local
  Postgres 16 against the exact production state (v2-seeded DB, no pricing
  column): `0 inserted / 56 refreshed`, re-run `0 / 0`, personal links
  untouched, bad values rejected by the check constraint.
- **Checks:** `npx tsc --noEmit` clean, `npm run lint` clean,
  `npx vitest run` 147 passed, `npm run build` succeeds.

### ~~8. Operational tables, renewals, project workspaces, and VPS Agents~~

**Done.** Career listings are a semantic table with match, remote, location,
source, and action columns plus sorting by best/lowest match, remote, location,
or discovery date. Projects is now a sortable summary table; each existing
project keeps its canonical `/projects/[id-or-slug]` workspace and gains a
development URL plus project-owned client communication timeline. Dragging uses
dedicated activator handles, so selectable text inside rows/cards no longer
starts a drag. Subscriptions expose their next charge and remaining/overdue
days everywhere, retain a custom category, and add operational group and
importance fields for the Money overview. Agents provides an own-only task
queue for authenticated VPS workers through atomic claim/report endpoints; it
does not execute arbitrary browser-side commands.

---

## Verification done this session
- `npx tsc --noEmit` — clean
- `npm run lint` (changed files) — clean
- `npx vitest run` — 242 passed across 26 files
- `npm run build` — succeeds
- `npm run test:e2e` — 43 passed, 31 intentional project skips, 0 failed

---

## Open / next tasks
No repository follow-up remains from these historical requests. Production-account, migration, secret, and smoke-test actions are tracked only in `NEEDED.md`.
