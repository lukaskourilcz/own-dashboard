# OwnDashboard system map

The current state of the app, written for a reader who has not seen the repository. Each part says what it does,
where the code lives, which outside system it talks to and what is switched on in production. State as of
22 October 2026 evening, main `7ef2247` (own-dashboard) and `893a495` (Quorum). Details live in the linked docs;
this page is the index to them.

## 1. What OwnDashboard is

A private, single-owner professional operating system for one software engineer and freelancer (Lukáš). It is
bilingual (English and Czech, full parity) and self-hosted on Vercel with a Supabase database. Every table is
own-only under row-level security. The product areas:

| Area | What it holds | Main code |
|---|---|---|
| Home | Daily focus (seven tasks), completion garden, weekly planning, cron and integration health | `src/app/api/daily-focus/route.ts`, `src/lib/weekly-planning.ts`, `src/lib/cron-heartbeat.ts` |
| Work | Projects (workspaces at `/projects/<id-or-slug>`), tasks, notes, prompts, tools, the link library | `src/lib/projects.ts`, `src/lib/project-*`, `src/lib/link-library.ts` |
| Opportunities | Freelance pipeline, clients and organizations (ARES and VIES checks), competition | `src/lib/freelance.ts`, `src/lib/competition.ts`, `src/lib/tax-registry.ts` |
| Career | The Oslo job search: roles, application drafts, preferences | `src/components/panels/oslo-career-workspace.tsx`, `src/lib/jobs` |
| Money | Czech invoices (VAT, QR, print), transactions and rules, subscriptions, static FX, bank sync, payment matching | `src/lib/invoices.ts`, `src/lib/finances.ts`, `src/lib/bank*`, `src/lib/payment-matching*` |
| Marketing | DNESKAi Instagram pipeline (below), devShark weekly drafts, knowledge import | `src/lib/marketing/`, `services/marketing-worker/` |
| Settings | Preferences, hidden tabs, integrations, language | `src/components/panels/settings-panel.tsx` |

The temporary product name is centralized in `src/lib/brand.ts`. Retired areas (personal habits, books, couples,
Pulse) must not return. Model calls are allowed only in the marketing workflow (`docs/ai-and-privacy.md`).

## 2. Architecture

- **Framework.** Next.js 16 (App Router, modified build: read `node_modules/next/dist/docs/` before code changes),
  React, React Query, Tailwind with semantic tokens, TypeScript, zod.
- **One shell.** `src/app/[[...slug]]/page.tsx` is the authenticated server boundary for every page;
  `src/components/dashboard-shell.tsx` is the persistent client shell with History API navigation. Data loads per
  route (`dashboardDataKeysForTab`, centralized query keys).
- **API.** Route handlers under `src/app/api/` (`marketing`, `cron`, `bank`, `calendar`, `github`, `google`, `money`,
  `registry`, `export`, `webhooks`, `dev-preview` and more). Writes check same-origin (`src/lib/csrf.ts`).
- **Database.** Supabase project `gcctapykhrdyxikieemn` (Postgres with pg_cron, pg_net, Vault, Storage).
  Migrations in `supabase/migrations/`; `docs/migration-guide.md` explains each one.
- **Hosting.** Vercel project `own-dashboard` (team `lukas-kourils-projects`), production URL
  `https://own-dashboard-tau.vercel.app`. **Merging to `main` deploys production.** Vercel crons: renewal warnings
  07:00, bank sync 06:00, payment match 06:30 (`vercel.json`). The marketing scheduler runs from Supabase instead
  (section 4).
- **Preview without data.** `/dev-preview` renders every screen from deterministic fixtures
  (`src/lib/demo/`) for visual and accessibility tests. It never calls a marketing API.
- **Gates.** `npm run lint`, `./node_modules/.bin/tsc --noEmit`, `npm run test` (vitest, about 2,440 tests, PGlite
  for SQL), `npm run build`, `./node_modules/.bin/playwright test` (port 3939). CI (`.github/workflows/ci.yml`) runs
  `check` and `e2e` on every push.

## 3. Outside systems and how they connect

| System | What OwnDashboard uses it for | Where | Production state |
|---|---|---|---|
| Supabase | Database, RLS, Storage (`marketing-assets`, `marketing-media`, `marketing-reels` once migration `20261023130000` is pushed), pg_cron scheduler, Vault secrets | `src/lib/supabase/` | Live |
| Vercel | Hosting, env vars, crons | `vercel.json` | Live |
| GitHub | Repos `lukaskourilcz/own-dashboard` and `lukaskourilcz/quorum`; project repo stats | `src/lib/github*` | Live |
| Google Calendar | Direct calendar read/write | `src/lib/calendar*`, `src/lib/google-*` | Live |
| Bank (GoCardless) | Daily transaction sync | `src/lib/gocardless.ts`, `src/lib/bank*` | As configured; no new bank work planned |
| Jina Reader | Link enrichment: only the submitted URL is sent | `src/lib/link-library.ts` | Live |
| **Quorum** (`lukaskourilcz/quorum`) | Source of the carousel studio (`@boardlessai/carousel-studio`), which OwnDashboard vendors as built output | `vendor/carousel-studio/`, `scripts/vendor-carousel-studio.sh` | Vendored at `893a495` |
| **Meta / Instagram** | Publishing to `@dneskai` (Creator account) with Instagram Login, Graph API v26.0 | `src/lib/marketing/publisher.ts`, `meta-account.ts`, `meta-credentials.ts` | Verified; account switch **off** after the pilot |
| **Anthropic** | Claude Sonnet 5.5 writes DNESKAi slides and captions | `src/lib/marketing/generation.ts`, `dneskai-generation.ts` | Key set, live |
| **Jev** (typesafe.ai, `jev-1.13.0`) | Classifies collected stories (category, relevance, on-topic) | `src/lib/marketing/dneskai-providers.ts` | Live, about $0.002 a night |
| Apify | Instagram profile collection and a research plan | `dneskai-collection.ts`, `dneskai-apify-research*.ts` | Token set, **off** (`MARKETING_DNESKAI_APIFY_ENABLED=false`) |
| LangSmith (EU) | Redacted traces of each generation and owner feedback | `src/lib/marketing/tracing.ts` | **Off**: no `LANGSMITH_*` in Production |
| n8n | Formerly ran DNESKAi; those workflows are archived and the routes answer 410 | `workflows/marketing/retired/` | Retired for DNESKAi |

Secrets live only in Vercel env vars and Supabase Vault, never in the repo.

## 4. The DNESKAi pipeline, end to end

DNESKAi is a Czech daily briefing about AI and technology. OwnDashboard turns each night's news into up to four
Instagram posts a day for `@dneskai` (slots 08:00, 12:30, 17:00, 20:00 Prague). Nothing publishes without the
owner approving the exact version.

### The scheduler

Supabase pg_cron calls `POST /api/marketing/tick` every 5 minutes (`minute`) and at 02:18 UTC (`daily`), signed with
`MARKETING_SCHEDULER_SECRET` (stored in Vault and Vercel). The route is `src/app/api/marketing/tick/route.ts`; the
steps are in `src/lib/marketing/scheduler.ts` and `scheduler-ports.ts`. Each tick runs at most one unit of each step,
under per-category leases (`marketing_scheduler_state`), and records itself in `marketing_ticks`:

| Step | What it does | Code |
|---|---|---|
| 1 collection | From 22:00 Prague, reads the native feeds (RSS, Atom, JSON, HTML; registry in `dneskai-registry.ts`), dedups, and asks Jev to classify the candidates | `dneskai-collection.ts`, `dneskai-native-feed.ts`, `free-feeds/` |
| 2 media | Downloads the pictures of selected stories (og:image, article figures), stores them by sha256 with credit, pHash and size | `dneskai-media*.ts` |
| 3 briefs | Groups stories into events, picks up to four, writes one brief per slot (`marketing_dneskai_briefs`) | `dneskai-events.ts`, `dneskai-briefs.ts` |
| 4 generation | Runs one queued job: Claude writes the deck and caption, the studio checks and renders the slides | `generation.ts`, `dneskai-generation.ts`, `worker-runtime.ts` |
| 5 publishing | Publishes an approved post inside its 15-minute window | `publisher.ts`, `orchestrator.ts` |
| 6 reconciliation | Confirms an uncertain publication from the account's media list, never posts twice | `publisher.ts` |
| 7 token | Refreshes the 60-day Instagram token ten days before it expires | `meta-account.ts` |
| 8 reminder | In-app notifications: first post of the day ready, and 60 minutes before the first unapproved slot | `dneskai-reminders.ts` |

Details: `docs/marketing-scheduling.md`, `docs/dneskai-native-feeds.md`, `docs/dneskai-source-media.md`,
`docs/dneskai-briefs.md`.

### Story selection

Jev marks each candidate's category (`ai-news`, `tech-news`, `tool`, `ai-project`, `marketing`, `other`) and
relevance. Eligible stories: relevance at least 0.85, news within 48 hours, others within 30 days. Similar
headlines become one event. The deployed SQL (`marketing_dneskai_finish`) picks one event per category, then by
relevance. A prepared migration switches this to relevance first, with at most one non-news story a day, and gives
held stories one automatic second review (section 8).

### Generation (`marketing-copy/6`)

One structured Claude call per brief (Claude Sonnet 5.5, $2/$10 per million tokens). The model writes the title,
caption, hashtags and 4 to 7 slides (types `cover-photo`, `figure`, `split`, `statement`, or one `single`), and picks
pictures by sha256 from the brief. Code then checks every rule before rendering:
- every number must appear in the evidence (dates do not count as support);
- no URL or emoji;
- only the fields a slide type draws;
- no sentence about sources or verification (`dneskaiTalksAboutSources`).

The studio's own fit check (`validateDneskaiDeck`) then refuses text that would be cut. One retry, on the next tick,
with targeted feedback. Code appends the AI disclosure („Text připravil jazykový model. Výběr a schválení: redakce
DNESKAi.“) and up to 10 hashtags, `#dneskai` first. Details: `docs/marketing-generation.md`.

### The owner's post rules (binding)

Set on 22 October 2026 and recorded in `.claude/skills/dneskai-post-content/SKILL.md`:
- The first slide, and a single-image post, shows only its headline.
- No slide shows a page count, a picture credit, a sources slide or any text about sources or verification.
- The caption names no sources or credits.
- A caption carries at most 10 hashtags.

Credits and source URLs stay in the database for provenance. Generation, the editor, the server edit path
(`dneskaiShownDeck`) and the studio templates all enforce this.

### Rendering: the carousel studio and its six kits

Slides are rendered by the vendored Quorum studio (`vendor/carousel-studio`, `renderDneskaiSlide`) into
1080 × 1350 JPEGs, stored in Storage and keyed by a render key (`dneskai-render.ts`). A post is drawn in one of six
kits:

| Kit | Character |
|---|---|
| Editorial (default) | Full-bleed photo cover, framed figures, blue statement slides |
| Bold | Condensed display type on blue and ink grounds |
| Explainer | Paper document with labelled header and framed figures |
| Magazine | Flat stacked cards, display serif |
| Ticker | Dark news screen, compact type, blue floor rule |
| Spotlight | The owner's photo-led reference: full-bleed photos fading into ink, centred headlines, before/after quote slides, optional round inset picture on the cover |

A deck names its kit (`kit` field, absent for Editorial). Each kit is designed in Quorum
(`studio/src/dneskai-kits/`, ADR `docs/design-lab/dneskai-kits/ADR.md`) and pinned by golden PNG hashes.
To change a kit: edit Quorum, build, merge, then re-vendor with `scripts/vendor-carousel-studio.sh <quorum> <commit>
--write`, update `DNESKAI_STUDIO` in `dneskai-render.ts` and run the vendor test.

### Review and approval: the Design Lab

Project DNESKAi → tab "Dnes ke schválení" (`src/components/marketing/dneskai/lab/`, model `dneskai-lab.ts`,
doc `docs/dneskai-design-lab.md`). The owner sees each post as the feed shows it, edits text, pictures, focal point,
slide type, order, inserted slides, caption, time and kit, and saves. A save makes a new revision with its own content
hash; approval binds exactly that hash (`marketing_approve_revision`). Actions:
- **Schválit:** approve.
- **Uložit a vykreslit:** save and render.
- **Publikovat hned:** approve for two minutes from now.
- **Přesunuto, znovu schválit:** a missed post moves to the next free slot.
- **Přegenerovat s poznámkou:** paid, about $0.02, behind a switch.
- **Vygenerovat hned:** admit a waiting brief now.
- **Vrátit**, **Přeskočit**, and **Schválit celý den**.

The "Zdroje (DNESKAi)" tab shows sources, feeds, the Instagram account panel ("Ověřit účet", publishing switch, token
expiry) and recovery actions. "Publikované" lists receipts; "Chyby a náklady" shows costs.

### Reels (prepared, off)

`renderDneskaiReel` (`dneskai-reel-render.ts`, #163) turns a post's rendered slides into a 1080 × 1920 MP4 with
`ffmpeg-static`: 3.5 s per slide, 0.5 s crossfades, a gentle zoom, AAC audio or a silent track. The route
`/api/marketing/dneskai/render-reel` (`maxDuration` 300 on Vercel Pro with Fluid Compute) stores it once per
revision hash and audio in the private `marketing-reels` bucket and returns a signed URL. Behind
`MARKETING_DNESKAI_REELS_ENABLED`. The owner's audio library lives in Zdroje → Hudba; the Lab post card picks a
track, which joins the revision and its hash. Details: `docs/dneskai-source-media.md`.

### Publishing

A post publishes only when all three are true: `MARKETING_PUBLISH_ENABLED`, `MARKETING_DNESKAI_PUBLISH_ENABLED` and the
account's own `enabled` switch. The two Vercel switches are on; the account switch is off since the pilot. The publisher checks the JPEGs (format, size, 8 MB),
the caption limits and the 24-hour quota. It creates the Instagram containers and the carousel parent, polls, and
calls `media_publish` once. It stores `remote_media_id` and the permalink (`marketing_publications`). After a timeout
it only reads the media list; it never posts twice.

### Money guards

- Every paid DNESKAi model call reserves its whole maximum first ($0.13 per job) under a rolling 24-hour ceiling,
  `MARKETING_DNESKAI_DAILY_GENERATION_USD` (default $1.00). The SQL function is `marketing_reserve_dneskai_generation`.
- A call the provider refused before billing counts $0.
- An unknown cost counts in full.
- Jev and Apify have their own nightly caps.

Costs show in "Chyby a náklady".

## 5. Data model (marketing, main tables)

| Table | Holds |
|---|---|
| `marketing_dneskai_runs`, `_stages`, `_candidates`, `_source_states` | Nightly collection runs, paid stages with reservations, collected stories, feed cursors |
| `marketing_media_assets`, `_asset_links`, `_collections` | Source pictures (sha256, credit, pHash), per-story links and collection state |
| `marketing_dneskai_briefs` | One brief per selected event and slot, its status and job |
| `marketing_dneskai_topics` | Topics (náměty): working titles the owner approves before anything is paid for, with kind, source, keyword, verdict, evidence and status (prepared, `20261023100000`, behind `DNESKAI_TOPICS_ENABLED`) |
| `marketing_campaigns`, `marketing_calendar_entries` | Daily campaign and slot entries a job is bound to |
| `marketing_jobs` | Generation jobs: request, fence, lease, result (deck, revision, usage) |
| `marketing_revisions` | Every version of a post: content, `content_hash`, render report, status, `approved_hash` |
| `marketing_audio_tracks` | Reel music library: title, artist, source, licence note, source page, file in `marketing-audio`, duration, mood, enabled (prepared, #164) |
| `marketing_publications` | Approved posts queued, claimed, published or in reconciliation, with receipts |
| `marketing_accounts`, `marketing_account_tokens` | `@dneskai` and its Instagram token (service-role only) |
| `marketing_ticks`, `marketing_scheduler_state` | Scheduler record and leases |
| `notifications` | In-app notifications, including the review reminders |

## 6. Database and switches still to apply

The repository lists every migration version production recorded (reconciled 22 October). Sixteen prepared
migrations are not applied yet: `20261022000000` through `20261023130100`. The owner applies them with
`npx supabase db push --linked` (steps in `docs/migration-guide.md`, "Applying the prepared migrations"). Then the
owner sets these switches in Vercel Production and redeploys:
- `DNESKAI_RICH_EVIDENCE_ENABLED`
- `DNESKAI_OWNER_RECOVERY_ENABLED`
- `DNESKAI_LAPSED_RELEASE_ENABLED`
- `MARKETING_PUBLICATION_REQUEUE_ENABLED`
- `DNESKAI_SELECTION_V2_ENABLED`
- `DNESKAI_REGENERATE_ENABLED`
- `DNESKAI_TOPICS_ENABLED` (after `20261023100000`)

Until then those features stay hidden or off and the daily tick logs one harmless `retention` error. Every switch is
listed in `docs/external-setup.md` and `docs/marketing-scheduling.md`.

## 7. Production state on 22 October 2026

- Collection, Jev, media and briefs have run every night since 21 October.
- The pilot is done: a single image published at 19:01 Prague (https://www.instagram.com/p/DezenXXkev_/) and a
  five-slide carousel at 20:00 (https://www.instagram.com/p/Dezk8kMlv0P/), both on the first attempt, about $0.046 in
  total. Both were made before the post rules and kits landed, so they still carry the old elements.
- After the pilot, publishing for `@dneskai` is off at the account switch (`marketing_accounts.enabled = false`),
  because daily operation is not authorized yet. Both Vercel switches stay on. Turning the account back on in
  DNESKAi → Zdroje resumes publishing; every post still needs approval of its exact version.
- Generation keeps preparing posts for review every night under the $1.00 daily ceiling.
- No GitHub issue is open in either repository; open owner work is in `NEEDED.md`.

## 8. Where to look next

| Question | Read |
|---|---|
| Owner's open actions | `NEEDED.md` |
| Owner list in plain language | `docs/reports/dneskai-audit-2026-10/owner-todo.md` |
| Migrations and their order | `docs/migration-guide.md` |
| Env vars and external setup | `docs/external-setup.md` |
| Generation, prompt, costs | `docs/marketing-generation.md` |
| Scheduler | `docs/marketing-scheduling.md` |
| Design Lab | `docs/dneskai-design-lab.md` |
| Kits (Quorum) | `quorum/docs/design-lab/dneskai-kits/ADR.md` |
| Post content rules | `.claude/skills/dneskai-post-content/SKILL.md` |
| Privacy and model calls | `docs/ai-and-privacy.md` |
| Product and design rules | `CLAUDE.md`, `AGENTS.md`, `docs/design/` |
| The October audit | `docs/reports/dneskai-audit-2026-10/` |
