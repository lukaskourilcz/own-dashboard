# OwnDashboard system map

This map describes the app, its code and outside systems. Integration states are the last verified 23 October 2026 receipts in [the handoff](astra-handoff.md), not fresh live checks. Main is `d6f60c7` at the 25 October fetch; Quorum studio provenance remains `893a495`. The app-wide implementation is in [draft PR #226](https://github.com/lukaskourilcz/own-dashboard/pull/226), with 34 prepared migrations still required before merge. Details and exact validation limits are in [the review](reports/app-wide-audit-2026-10-23/review.md).

## 1. What OwnDashboard is

A private, single-owner professional operating system for one software engineer and freelancer (Lukáš). It is
bilingual (English and Czech, full parity) and self-hosted on Vercel with a Supabase database. Private owner records use own-only row-level security; integration credentials remain inaccessible to browser roles. The product areas:

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
  `registry`, `export`, `webhooks`, `dev-preview` and more). Browser-owned writes check same-origin (`src/lib/csrf.ts`); automation and inbound webhooks use their signature boundaries.
- **Database.** Supabase project `gcctapykhrdyxikieemn` (Postgres with pg_cron, pg_net, Vault, Storage).
  Migrations in `supabase/migrations/`; `docs/migration-guide.md` explains each one.
- **Hosting.** Vercel project `own-dashboard` (team `lukas-kourils-projects`), production URL
  `https://own-dashboard-tau.vercel.app`. **Merging to `main` deploys production.** Vercel crons: renewal warnings
  07:00, bank sync 06:00, payment match 06:30 (`vercel.json`). The marketing scheduler runs from Supabase instead
  (section 4).
- **Preview without data.** `/dev-preview` renders every screen from deterministic fixtures
  (`src/lib/demo/`) for visual and accessibility tests. Default preview readers use in-memory fixtures; explicit transport tests intercept a nonexistent backend. Ordinary production builds return 404.
- **Gates.** `npm run lint`, `./node_modules/.bin/tsc --noEmit`, `npm run test` (Vitest and migrated PGlite; exact snapshot results in the audit report), `npm run build`, `./node_modules/.bin/playwright test` (port 3939). CI (`.github/workflows/ci.yml`) runs
  `check` and `e2e` on every push.

## 3. Outside systems and how they connect

| System | What OwnDashboard uses it for | Where | Production state |
|---|---|---|---|
| Supabase | Database, RLS, Storage (`marketing-assets`, `marketing-media`, `marketing-reels`, `marketing-audio`; migrations through `20261023130300` applied 23 October 2026), pg_cron scheduler, Vault secrets | `src/lib/supabase/` | Live |
| Vercel | Hosting, env vars, crons | `vercel.json` | Live |
| GitHub | Repos `lukaskourilcz/own-dashboard` and `lukaskourilcz/quorum`; project repo stats | `src/lib/github*` | Live |
| Google Calendar | Direct calendar read/write | `src/lib/calendar*`, `src/lib/google-*` | Live |
| Bank (GoCardless) | Daily transaction sync | `src/lib/gocardless.ts`, `src/lib/bank*` | As configured; no new bank work planned |
| Jina Reader | Link enrichment: only the submitted URL is sent; DNESKAi topic briefs: only an approved link-library or manual topic's URL (#210) | `src/lib/link-library.ts`, `src/lib/marketing/dneskai-topic-source.ts` | Live; topic briefs behind `DNESKAI_TOPIC_BRIEFS_ENABLED` |
| **Quorum** (`lukaskourilcz/quorum`) | Source of the carousel studio (`@boardlessai/carousel-studio`), which OwnDashboard vendors as built output | `vendor/carousel-studio/`, `scripts/vendor-carousel-studio.sh` | Vendored at `893a495` |
| **Meta / Instagram** | Publishing to `@dneskai` (Creator account) with Instagram Login, Graph API v26.0: carousels, single images and Reels (`media_type=REELS`) | `src/lib/marketing/publisher.ts`, `meta-account.ts`, `meta-credentials.ts` | Verified; account publishing switch **on** by explicit owner request on 23 October; exact-version approval still required |
| **Facebook Login for Business** | A second credential mode (#166, `MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE=facebook`): `graph.facebook.com` with the token of the Facebook Page linked to `@dneskai`, renewal through `fb_exchange_token` (`MARKETING_META_APP_ID`, `MARKETING_META_APP_SECRET`), private replies through `POST /<PAGE_ID>/messages` (#216) | `meta-credentials.ts`, `meta-account.ts`, `dneskai-engagement-ports.ts` | Prepared, **not set up**: no Page linked yet (Astra #181) |
| **Meta Audio API** | `GET /ig_audio`: the trending music and original sounds `@dneskai` may use; exists only under Facebook Login (#167) | `dneskai-audio-trends.ts` | Prepared, **off** (`DNESKAI_AUDIO_TRENDS_ENABLED`) |
| **Meta webhooks** (inbound) | Instagram sends new comments to `POST /api/webhooks/instagram` (signed with the Instagram app secret, or the Meta app secret under Facebook Login); the comment watcher answers them at once, polling stays the fallback (#161) | `src/app/api/webhooks/instagram/route.ts`, `dneskai-instagram-webhook.ts` | Configured and callback verified on 23 October (#179 closed); only comments subscribed. Real keyword/DM delivery remains unverified (#180) |
| **Anthropic** | Claude Sonnet 5.5 writes DNESKAi slides and captions; Claude Haiku 5.5 titles topics and gives FACT or HYPE verdicts | `src/lib/marketing/generation.ts`, `dneskai-generation.ts`, `dneskai-topic-model.ts` | Key set; generation live, Haiku calls **off** (`DNESKAI_TITLING_ENABLED`, `DNESKAI_FACT_OR_HYPE_ENABLED`) |
| **Jev** (typesafe.ai, `jev-1.13.0`) | Classifies collected stories (category, relevance, on-topic) | `src/lib/marketing/dneskai-providers.ts` | Live, about $0.002 a night |
| Apify | Instagram profile collection (news and, with scouting, education profiles); a $126 research plan; reel transcripts for FACT or HYPE (`apify~instagram-reel-scraper`, $0.05 each, $0.50 a day); the TikTok CZ sound chart (`clockworks~tiktok-trends-scraper`, $0.10 a day) | `dneskai-collection.ts`, `dneskai-apify-research*.ts`, `dneskai-fact-or-hype.ts`, `dneskai-audio-tiktok.ts` | Token set, all **off** (`MARKETING_DNESKAI_APIFY_ENABLED=false`; research, transcripts and TikTok behind their own switches) |
| LangSmith (EU) | Redacted traces of each generation and owner feedback | `src/lib/marketing/tracing.ts` | Production EU configuration set; a redacted generation trace verified on 23 October (#183 closed), Base 14-day retention |
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
| 1 collection | From 22:00 Prague, reads the native feeds (RSS, Atom, JSON, HTML; registry in `dneskai-registry.ts`, or the owner's `marketing_dneskai_sources` rows with `DNESKAI_SOURCES_TABLE_ENABLED`, through `dneskai-source-catalog.ts`), dedups, and asks Jev to classify the candidates | `dneskai-collection.ts`, `dneskai-native-feed.ts`, `free-feeds/` |
| 1a scouting | Only with `DNESKAI_SCOUTING_ENABLED`: hourly from 22:00 to 08:00, turns the night's reports from education sources and library links rated 4 or 5 into proposed topics (`marketing_dneskai_topics`), no model call and no lease; with `DNESKAI_FACT_OR_HYPE_ENABLED` it also buys transcripts of FACT or HYPE reels and asks Claude Haiku 5.5 for the verdict; with `DNESKAI_TITLING_ENABLED` it expires news topics after 48 hours and from 02:00 titles the untitled ones in one Claude Haiku 5.5 call | `dneskai-scouting.ts`, `dneskai-fact-or-hype.ts`, `dneskai-titling.ts` |
| 2 media | Downloads the pictures of selected stories (og:image, article figures), stores them by sha256 with credit, pHash and size | `dneskai-media*.ts` |
| 3 briefs | Groups stories into events, picks up to four, writes one brief per slot (`marketing_dneskai_briefs`); with `DNESKAI_TITLING_ENABLED` the events become news topics instead | `dneskai-events.ts`, `dneskai-briefs.ts` |
| 3a enrichment | Only with `DNESKAI_TOPIC_BRIEFS_ENABLED`: approved topics become briefs (news: the event's brief; education: a brief of the report; link-library and manual topics: their URL read through Jina Reader and stored as an `owner-link` report first) and queued jobs; topic status approved → enriching → briefed → generated | `dneskai-topic-bridge.ts`, `dneskai-topic-source.ts` |
| 4 generation | Runs one queued job: Claude writes the deck and caption, the studio checks and renders the slides | `generation.ts`, `dneskai-generation.ts`, `worker-runtime.ts` |
| 5 publishing | Publishes an approved post inside its 15-minute window | `publisher.ts`, `orchestrator.ts` |
| 6 reconciliation | Confirms an uncertain publication from the account's media list, never posts twice | `publisher.ts` |
| 7 token | Refreshes the 60-day Instagram token ten days before it expires | `meta-account.ts` |
| 8 engagement | Prepared, off: replies once by DM to a keyword comment under a post of the last seven days, then posts the public reply (`DNESKAI_ENGAGEMENT_ENABLED`, #160); the webhook (#161) hands a new comment to the same watcher code at once | `dneskai-engagement-watch.ts`, `dneskai-engagement-ports.ts` |
| 9 reminder | In-app notifications: first post of the day ready, and 60 minutes before the first unapproved slot | `dneskai-reminders.ts` |

The daily tick runs four duties instead: **renewal** (signed asset URLs that expire within 48 hours), **purge** (source
pictures unused for 30 days), **retention** (`marketing_ticks` older than 14 days; it records an error until
`20261022000000` is pushed) and, only with `DNESKAI_AUDIO_TRENDS_ENABLED`, **audio-trends**: the day's trending sounds
from Meta's Audio API and, with `DNESKAI_TIKTOK_TRENDS_ENABLED`, one TikTok CZ chart run that marks matching sounds
(`dneskai-audio-trends.ts`, `dneskai-audio-tiktok.ts`).

Details: `docs/marketing-scheduling.md`, `docs/dneskai-native-feeds.md`, `docs/dneskai-source-media.md`,
`docs/dneskai-briefs.md`.

### Story selection

Jev marks each candidate's category (`ai-news`, `tech-news`, `tool`, `ai-project`, `marketing`, `other`) and
relevance. Eligible stories: relevance at least 0.85, news within 48 hours, others within 30 days. Similar
headlines become one event. The deployed SQL (`marketing_dneskai_finish`) picks one event per category, then by
relevance. A prepared migration switches this to relevance first, with at most one non-news story a day, and gives
held stories one automatic second review (section 6).

### Generation (`marketing-copy/7`)

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

The DNESKAi workspace has four tabs and a `⋯` menu (#169; the project header is gone from every project, #171):
- **Dnes ke schválení:** Náměty (topics to approve or reject, #154) above the Lab, which has channel sub-tabs
  Instagram, Threads and LinkedIn (the last two disabled, #170). The Lab also edits the comment keyword, DM and public
  reply (`DNESKAI_ENGAGEMENT_EDITOR_ENABLED`, #159), the format (Karusel or Reel) and the Reel's music.
- **Kalendář:** the week's slots.
- **Příspěvky:** every post, latest first, with filter chips, the Instagram link, keyword-comment receipts (#162) and
  a hint to add music in the app to a fresh carousel (#168).
- **Zdroje:** the source list (Instagram profiles and websites, editable with `DNESKAI_SOURCES_TABLE_ENABLED`, #174),
  Denní mix (#156) and Hudba, the Reel music library with its Trendy zvuky (#164, #167).
- **`⋯` menu:** Chyby a náklady (costs and errors), Účet Instagram ("Ověřit účet", the publishing switch, token
  expiry, the comment-reply switch and the webhook subscription), Obnova témat (last night's collection, held topics and
  the recovery actions) and Klávesové zkratky, then the general project sections.

### Reels and music (prepared, off)

`renderDneskaiReel` (`dneskai-reel-render.ts`, #163) turns a post's rendered slides into a 1080 × 1920 MP4 with
`ffmpeg-static`: 3.5 s per slide, 0.5 s crossfades, a gentle zoom, AAC audio or a silent track. The route
`/api/marketing/dneskai/render-reel` (`maxDuration` 300 on Vercel Pro with Fluid Compute) stores it once per
revision hash and audio in the private `marketing-reels` bucket and returns a signed URL. Behind
`MARKETING_DNESKAI_REELS_ENABLED`. The owner's audio library lives in Zdroje → Hudba; the Lab post card picks a
track, which joins the revision and its hash. A carousel post can switch to "Reel" in the Lab (education posts start as
one); the publishing step renders its MP4 up to 45 minutes before the slot and publishes it as `media_type=REELS`
with slide 1 as the cover. Under Facebook Login a Reel may instead carry a trending sound from Meta's Audio API:
the MP4 is then silent and the publisher sends `audio_configuration` (`DNESKAI_AUDIO_TRENDS_ENABLED`, #167). Zdroje →
Hudba → Trendy zvuky ranks those sounds by how often the tracked education profiles used them in their reels this
week, and marks the ones also rising on TikTok CZ. Details: `docs/dneskai-source-media.md`,
`docs/marketing-scheduling.md#reels-165`.

### Publishing

A post publishes only when all three are true: `MARKETING_PUBLISH_ENABLED`, `MARKETING_DNESKAI_PUBLISH_ENABLED` and the
account's own `enabled` switch. The two Vercel switches are on; the account switch is off since the pilot. The publisher checks the JPEGs (format, size, 8 MB) or
the Reel's MP4 (size, sha256), the caption limits and the 24-hour quota. It creates the Instagram containers and the carousel parent, polls, and
calls `media_publish` once. It stores `remote_media_id` and the permalink (`marketing_publications`). After a timeout
it only reads the media list; it never posts twice.

### Money guards

- Every paid DNESKAi model call reserves its whole maximum first ($0.13 per job) under a rolling 24-hour ceiling,
  `MARKETING_DNESKAI_DAILY_GENERATION_USD` (default $1.00). The SQL function is `marketing_reserve_dneskai_generation`.
- A call the provider refused before billing counts $0.
- An unknown cost counts in full.
- Jev and Apify have their own nightly caps.
- Paid topic work goes through a second ledger, `marketing_private.dneskai_topic_spend`: Claude Haiku calls for
  titling and FACT or HYPE count inside the $1.00 ceiling; reel transcripts have their own
  `MARKETING_DNESKAI_TRANSCRIPT_DAILY_USD` (default $0.50) and the TikTok chart run its own
  `MARKETING_DNESKAI_TIKTOK_DAILY_USD` (default $0.10).

Costs show in "Chyby a náklady" in the `⋯` menu.

### Routes

| Route | What it does |
|---|---|
| `POST /api/marketing/tick` | The scheduler, signed by pg_cron |
| `GET /api/marketing/dneskai/review` | The workspace read: posts, decks, briefs, publications, jobs |
| `GET`, `POST /api/marketing/dneskai/topics` | Topics and the owner's approve, reject, restore, edit and create (404 without `DNESKAI_TOPICS_ENABLED`) |
| `GET`, `PUT /api/marketing/dneskai/daily-mix` | The daily mix (404 without `DNESKAI_DAILY_MIX_ENABLED`) |
| `GET`, `POST /api/marketing/dneskai/source-list` | The sources Zdroje lists, and the owner's save and remove |
| `GET`, `POST /api/marketing/dneskai/audio` | The music library, uploads and the day's trending sounds (404 without `MARKETING_DNESKAI_REELS_ENABLED`) |
| `POST /api/marketing/dneskai/render-reel` | Renders and stores a Reel's MP4 (404 without `MARKETING_DNESKAI_REELS_ENABLED`) |
| `POST /api/marketing/dneskai/generate`, `briefs`, `candidates` | Generate now; retry, reslot and release a brief; re-review a held report |
| `GET /api/marketing/dneskai/costs`, `media`, `sources`; `POST fit`, `preview` | Errors and costs (complete owned totals through `marketing_dneskai_cost_totals`, bounded diagnostics), the picture tray, the recovery read, text fit and one-slide preview |
| `POST /api/marketing/revisions` | Edit, approve, approve the day, approve-at, publish now, regenerate, return, skip |
| `POST /api/marketing/accounts/verify`, `enable`, `engagement`, `webhook` | Verify the account, its publishing switch, its reply switch and the comment subscription |
| `GET`, `POST /api/webhooks/instagram` | Meta's subscription check and signed comment deliveries (404 until configured) |

## 5. Data model (marketing, main tables)

| Table | Holds |
|---|---|
| `marketing_dneskai_runs`, `_stages`, `_candidates`, `_source_states` | Nightly collection runs, paid stages with reservations, collected stories, feed cursors |
| `marketing_media_assets`, `_asset_links`, `_collections` | Source pictures (sha256, credit, pHash), per-story links and collection state |
| `marketing_dneskai_briefs` | One brief per selected event and slot, its status and job |
| `marketing_dneskai_daily_mix` | The owner's news and education posts a day and active times (prepared, `20261023100300`, behind `DNESKAI_DAILY_MIX_ENABLED`) |
| `marketing_dneskai_sources` | The sources Zdroje edits: Instagram handles and websites with kind, topic, tier, weekdays, item cap and switch; seeded once from the registry file (prepared, `20261023110000`, behind `DNESKAI_SOURCES_TABLE_ENABLED`) |
| `marketing_dneskai_topics` | Topics (náměty): working titles the owner approves before anything is paid for, with kind, source, keyword, verdict, evidence and status (prepared, `20261023100000`, behind `DNESKAI_TOPICS_ENABLED`) |
| `marketing_campaigns`, `marketing_calendar_entries` | Daily campaign and slot entries a job is bound to |
| `marketing_jobs` | Generation jobs: request, fence, lease, result (deck, revision, usage) |
| `marketing_revisions` | Every version of a post: content, `content_hash`, render report, status, `approved_hash` |
| `marketing_audio_trends` | Trending sounds from Meta's Audio API per day, with the niche count and the TikTok mark (prepared, `20261023130200`, #167; Facebook Login only) |
| `marketing_audio_tracks` | Reel music library: title, artist, source, licence note, source page, file in `marketing-audio`, duration, mood, enabled (prepared, `20261023130100`, #164) |
| `marketing_publications` | Approved posts queued, claimed, published or in reconciliation, with receipts |
| `marketing_accounts`, `marketing_account_tokens` | `@dneskai` and its Instagram token (service-role only); the account's comment-reply switch and block (prepared, `20261023120000`) |
| `marketing_instagram_comment_replies`, `marketing_instagram_comment_checks` | One private reply per keyword comment (comment id, media, keyword, status; no commenter data) and the watcher's cursor and counts per post (prepared, `20261023120000`, #160) |
| `marketing_private.dneskai_topic_spend` | Paid topic work: transcripts, topic model calls and TikTok chart runs, each reserved before it starts (prepared, `20261023100100`, `20261023130300`) |
| `marketing_private.dneskai_apify_research`, `marketing_dneskai_research_metrics` | The research plan's ledger and its derived public metrics (prepared, `20261022013957`) |
| `marketing_events` | Publication and revision events, including one `dneskai-reel-rendered` row per stored Reel |
| `marketing_ticks`, `marketing_scheduler_state` | Scheduler record and leases |
| `notifications` | In-app notifications, including the review reminders |

Storage buckets, all private: `marketing-assets` (rendered slide JPEGs), `marketing-media` (source pictures),
`marketing-reels` (Reel MP4s, `20261023130000`) and `marketing-audio` (library tracks, `20261023130100`); both migrations were applied on 23 October 2026.

## 6. Database and activation status

The 23 prepared migrations `20261022000000` through `20261023130300` were applied on 23 October 2026 under owner authorisation. The routine feature switches and editor activation are deployed; see NEEDED.md and the Astra handoff for the recorded state. Do not repeat the completed migration push.

The audit implementation and subsequent app-wide review add **thirteen prepared, unapplied migrations**: `20261023135551_dneskai_engagement_receipts.sql` for complete owner/RLS-scoped receipts, `20261023164118_app_wide_rls_initplans.sql` for statement-level identity checks, `20261023170010_project_parent_rls_lookup.sql` for non-recursive parent checks, `20261023175801_daily_focus_garden_summary.sql` for complete execution history, `20261023183345_career_owner_day.sql` for Career dates, `20261023190841_invoice_document_transaction.sql` for atomic invoice saves, and `20261023200938_atomic_knowledge_documents.sql` for atomic prompt/resource saves, repeat-safe curated imports and complete bounded collections, and `20261023210737_library_category_merge.sql` for atomic category merges, and `20261023212535_atomic_payment_matching.sql` for complete matching snapshots, atomic settlements and service-only owner discovery, and `20261023221856_transaction_rule_context.sql` for complete financial rule/parent-id context under invoker ownership, and `20261023222504_confirmed_transaction_import.sql` for confirmed CSV/bank batches under the existing partial unique index, and `20261023233432_atomic_bank_credentials.sql` for service-only atomic Fio credential/connection storage and removal, and `20261024001739_invoice_payment_state.sql` for atomic manual payment state and match-metadata cleanup. All new functions use invoker rights and explicit grants. Apply in filename order before merging the audit branch. No Production settings or data were changed by these local code/UX tests. Current validation and rollout status: [app-wide review](reports/app-wide-audit-2026-10-23/review.md).

Remaining activation dependencies are distinct:

- Facebook Login and trending Meta audio require the intended DNESKAi Facebook Page/connection (#181).
- The live keyword-reply check needs an owner-named second account and a specifically approved keyword post (#180).
- Optional FACT or HYPE, titling/topic-brief and TikTok activation/spend decisions remain in NEEDED.md/#178; do not infer approval from enabled routine features.

Every switch, with its default and prerequisite, is listed in `docs/marketing-scheduling.md#switches`; the setup steps
are in `docs/external-setup.md`. Astra's issue #178 sets the Vercel values.

## 7. Production state on 23 October 2026

- Collection, Jev, media and briefs have run every night since 21 October.
- The pilot is done: a single image published at 19:01 Prague (https://www.instagram.com/p/DezenXXkev_/) and a
  five-slide carousel at 20:00 (https://www.instagram.com/p/Dezk8kMlv0P/), both on the first attempt, about $0.046 in
  total. Both were made before the post rules and kits landed, so they still carry the old elements.
- Publishing for `@dneskai` was enabled on 23 October 2026 at the owner’s explicit request. Every post still requires approval of its exact saved version. The first Reel was published through Instagram’s native uploader with a library track: [publication evidence](reports/dneskai-first-reel-2026-10-23.md). This does not verify OwnDashboard’s automatic Reel publisher.
- Generation keeps preparing posts for review every night under the $1.00 daily ceiling.
- The education/Reels plan and follow-ups are merged; routine activation is recorded in NEEDED.md. Remaining owner-dependent checks and optional spend decisions stay explicit there and in #178, #180 and #181. The local audit implementation has its own [verification report](reports/dneskai-audit-implementation-2026-10-23.md).

## 8. Where to look next

| Question | Read |
|---|---|
| Owner's open actions | `NEEDED.md` |
| Migrations and their order | `docs/migration-guide.md` |
| Env vars and external setup | `docs/external-setup.md` |
| Generation, prompt, costs | `docs/marketing-generation.md` |
| Scheduler | `docs/marketing-scheduling.md` |
| Design Lab | `docs/dneskai-design-lab.md` |
| The education and Reels plan | `docs/plans/2026-10-22-dneskai-education-reels-plan.md` |
| Kits (Quorum) | `quorum/docs/design-lab/dneskai-kits/ADR.md` |
| Post content rules | `.claude/skills/dneskai-post-content/SKILL.md` |
| Privacy and model calls | `docs/ai-and-privacy.md` |
| Product and design rules | `CLAUDE.md`, `AGENTS.md`, `docs/design/` |
| The October audit | `docs/reports/dneskai-audit-2026-10/` |
