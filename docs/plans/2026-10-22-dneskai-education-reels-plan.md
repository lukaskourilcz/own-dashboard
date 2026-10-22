# DNESKAi: daily news plus education, Reels with audio, comment-to-DM, and a simpler workspace

Plan written 22 October 2026 and approved by the owner the same evening (decisions in section 6). Each work item
below is one GitHub issue for Opus. State as of main `77ea0b7`; the research behind each decision is in section 9.

## 1. What changes, in one paragraph

Today the pipeline turns last night's news into up to four posts a day and pays for generation before the owner sees
anything. The new daily rhythm is one news post and one or two educational posts (a skill, a tool, an app, a
workflow). Every post starts as a title the owner approves or rejects in a new "Náměty" list; only approved titles
get enrichment, pictures and a generated deck. Each approved post carries three new things the owner edits in the
Design Lab before approval: a comment keyword, the message the account sends by DM to anyone who comments that
keyword, and an audio track. Posts can publish as Reels (a rendered slideshow with audio) so they reach the Reels
tab. The DNESKAi workspace shrinks to three tabs plus Zdroje and an overflow menu.

## 2. Facts that shape the design

These come from the official Meta docs and the repository, checked on 22 October 2026 (sources in section 9).

1. **No API can put music on an image or carousel post.** Music through the API exists only for Reels.
2. **Licensed Instagram music on Reels needs the Facebook Login flavour of the API.** The Instagram Audio API
   (`GET /ig_audio`, `audio_configuration` on a REELS container) says it "is not supported on the Instagram API with
   Instagram Login". @dneskai is connected through Instagram Login today. Under Instagram Login the only audio a
   Reel can carry is audio baked into the MP4, and a baked-in commercial song gets muted or blocked by Rights Manager.
3. **The same Audio API is the trending-sound feed.** Called without a search query it "returns trending original
   sounds or music by default", already filtered to tracks the account may use. So the migration to Facebook Login
   buys both legal trending audio and its discovery in one step.
4. **Comment-triggered DMs are a standard feature.** A Private Reply (`POST /<IG_ID>/messages` with
   `recipient.comment_id`) may be sent once per comment within 7 days, needs only `instagram_business_basic` and
   `instagram_business_manage_comments`, both already granted. Webhooks may not deliver in Development mode; polling
   `/<media-id>/comments` works in any mode at 750 calls an hour.
5. **The post-content rules ban a call to comment in model output** (`dneskai-generation.ts:114`, the binding
   skill). The keyword line therefore has to be written by code into the caption, like the AI disclosure, from a
   field the owner approves.
6. **The publisher already has `reel` and `story` branches** (`publisher.ts:109-112`) but nothing renders video and no
   Meta webhook exists. Briefs cannot exist without a nightly run, an event id and collected stories, so an
   owner-approved topic needs a schema change before it can become a brief.
7. **Instagram caps hashtags at five** since December 2025 (announced by @creators, rollout gradual). The owner
   keeps DNESKAi's cap at ten anyway (22 October 2026); the Graph API documents a limit of 30.
8. **@itstundeanthony's engine is the keyword CTA, not music.** 42 of his last 80 posts ask for a keyword; those
   posts get a median of 410 comments against 53 for the rest. 74 of 80 use original audio. FACT or HYPE verdicts are
   spoken in the video, never written in the caption, so classifying them needs a transcript.

## 3. The new daily flow

```
22:00  collection (unchanged) + scouting: Instagram profiles, websites, link library
02:30  titling: one cheap model call writes 8 to 12 Czech working titles  -> status proposed
07:00  owner opens Dnes ke schválení -> Náměty: taps approve / reject on titles
       approved -> enrichment (pages, pictures, transcript if a reel) -> brief -> generation -> Lab card
       Lab card: deck, caption, keyword, DM message, audio, format (carousel / reel), time -> approve
slot   publish (carousel via API, or reel: render MP4 -> upload -> REELS container -> publish)
+0..7d comment watcher: keyword comment -> one private reply with the approved DM message
```

Costs per day at two posts: scouting about $0.05 (Apify, 20 to 30 reels), titling about $0.01 (Claude Haiku 5.5),
transcripts of FACT or HYPE reels about $0.05 each, generation 2 × about $0.03, rendering $0. Under $0.30 a day.

**Queue rule.** A proposed title waits in Náměty until the owner decides. News titles expire after 48 hours and move
to an archive; educational titles never expire. An approved title with no slot waits as "approved, unslotted"; when
its deck is ready it takes the nearest free slot from today's or tomorrow's list, news first at 08:00, education at
17:00, then any free slot. Nothing is generated for a title the owner has not approved.

## 4. Work items for Opus

Each item is one issue. Order matters inside an epic; epics A, B, C and D can run in parallel on separate branches.
Flags default off; a merged PR must not change production behaviour until the owner flips the flag.

### Epic A: topics before briefs (cost-first pipeline)

**A1. Topic table and read model.** Migration `marketing_dneskai_topics`: id, user_id, project_id, kind
(`news` | `education`), source_kind (`feed` | `instagram` | `library` | `manual`), source_ref (unique per owner),
title_cs, summary, keyword, verdict (`fact` | `hype` | null), evidence jsonb (urls, excerpts, transcript hash, picture
candidates), status (`proposed` | `approved` | `rejected` | `expired` | `enriching` | `briefed` | `generated`),
proposed_for date, approved_at, brief_id, created_at, updated_at. Own-only RLS, service-role writes. Read model and
route `GET/POST /api/marketing/dneskai/topics` (approve, reject, restore, edit title and keyword). Document in
`docs/migration-guide.md`. Flag `DNESKAI_TOPICS_ENABLED`.

**A2. Scouting step.** New scheduler step `scouting` after collection. Sources: (a) the Instagram profiles in the
registry marked `education` (reel captions, `musicInfo`, play counts via `apify/instagram-reel-scraper`,
`onlyPostsNewerThan` 2 days, under the existing $0.04 per profile and $0.25 per day caps); (b) new native feeds for
tools (GitHub trending AI, Product Hunt AI topic, Hacker News Show HN via the free Algolia API, the Anthropic and
OpenAI changelogs); (c) the owner's link library: `ai_links` with `usefulness_rating >= 4`, `record_type = 'link'`,
not yet used as a topic. Each hit becomes a topic candidate with evidence and no model call. Reuse
`dneskai-registry.ts`, `dneskai-native-feed.ts` and the Apify provider.

**A3. FACT or HYPE classifier.** For reels whose caption or on-screen text contains "fact or hype", buy the transcript
(reel scraper transcript add-on, about $0.041 per started minute, cap 10 reels a night under its own $0.50 ceiling),
then one Haiku call classifies verdict `fact` | `hype` | `unclear` and names the tool. Only `fact` and `unclear` reach
the owner; `hype` is kept as a rejected topic with its reason, because a "what not to buy" post is also a topic the
owner may want. Verdict and tool name go into evidence.

**A4. Titling step.** One structured Claude Haiku 5.5 call per night over all candidates (at most 40) writes a Czech
working title (max 60 characters), a one-sentence summary, a suggested one-word keyword and a suggested kind. Budget
through the existing job and reservation path with `maxCostUsd 0.02`, under the $1 daily ceiling. Dedupe against
titles of the last 30 days. The four news events the briefs step already selects become `news` topics instead of
briefs; the briefs step only runs for approved topics (A6).

**A5. Náměty in the Lab.** A section at the top of Dnes ke schválení: a list of proposed titles grouped News /
Education, each with kind chip, source domain, suggested keyword and two buttons (Schválit, Zamítnout), keyboard
operable, bulk "Schválit vybrané". Rejected and expired titles sit behind a "Zobrazit zamítnuté" disclosure.
EN/CS copy in `dneskai-lab.ts`. No model call from the browser.

**A6. Topic to brief bridge and slotting.** Allow a brief without a collection run: migration makes `run_id`
nullable with a check `run_id is not null or topic_id is not null`, adds `topic_id`, relaxes `member_ids` for topic
briefs, and gives `admit_brief` a `topic:` source kind. Enrichment for an approved topic: fetch the evidence URLs
through the existing Jina Reader path (URL only), collect pictures through `dneskai-media` (og:image, GitHub social
preview, article figures), write the brief, queue generation. Slotting follows the queue rule in section 3 using
`dneskaiFreeSlots` and `dneskaiNextFreeSlot`. Expire news topics after 48 hours in the daily tick.

**A7. Daily mix and slot count.** Replace "up to four news posts" with a per-day target the owner sets in Zdroje:
default 1 news + 1 education, slots 08:00 and 17:00, 12:30 and 20:00 optional. Keep the slot constants in one place
(`DNESKAI_BRIEF_SLOTS` and the SQL copy in `20261022141512`).

### Epic B: comment keyword and DM reply

**B1. Revision fields.** Add optional `engagement: { keyword, replyMessage, publicReply }` to `ContentRevisionSchema`
(strict object, model on `collaborators`), regenerate `contracts/marketing-content-v1.schema.json`, carry it through
generation, the edit route, `dneskai-revision-edit.ts` (no re-render when only engagement changes) and the read model.
The content hash covers it automatically, so approval binds the exact message.

**B2. Generation writes the DM message, code writes the caption line.** Extend `DneskaiCopySchema` with `replyMessage`
(Czech, 400 to 900 characters, may contain one URL from the evidence, educational: what the tool is, how to start in
three steps, cost, one caveat) under the same truth rules. The model never writes the CTA. `assembleDneskaiCaption`
appends, before the disclosure, a code-owned line from the approved keyword: „Napište do komentáře „SKILL" a pošleme
vám návod do zpráv." Update `.claude/skills/dneskai-post-content/SKILL.md`: the keyword line is code-authored and
allowed; model text still carries no CTA. The hashtag cap stays at 10 (owner decision, 22 October 2026).

**B3. Lab editor for engagement.** In the post card: keyword field (one word, Latin letters, validated, shown as a
chip), DM message textarea with counter and a DM-bubble preview, public reply field (optional, default „Poslali jsme
vám to do zpráv."), all part of the dirty check and the version hash. Czech and English copy.

**B4. Comment watcher (polling first).** New scheduler step `engagement` every tick: for publications younger than
7 days, `GET /<media-id>/comments?fields=id,text,timestamp` with a per-media cursor, match normalised text (lowercase,
no diacritics, no punctuation) against the revision's keyword, send one Private Reply per comment with the approved
message, optionally one public `/replies`. Table `marketing_instagram_comment_replies` (comment id unique, media id,
matched keyword, sent_at, status, error code; no commenter username stored). Respect the one-reply rule and the 7-day
window; log codes only. Flag `DNESKAI_ENGAGEMENT_ENABLED`; a second switch per account in Zdroje.

**B5. Webhook upgrade.** Route `/api/webhooks/instagram`: GET verify (`hub.challenge`), POST with
`X-Hub-Signature-256` check against the app secret, 200 within 2 seconds, dedupe by comment id, hand off to the same
matcher as B4 through Next `after()`. Owner action documented in `docs/external-setup.md`: callback URL and verify
token in the Meta app, `POST /<IG_ID>/subscribed_apps?subscribed_fields=comments`, "Allow access to messages" in the
Instagram app, and switching the app to Live if Development mode delivers nothing. Polling stays as the fallback.

**B6. Engagement receipts.** Publikované shows per post: comments seen, keyword matches, replies sent, failures.

### Epic C: Reels with audio

**C1. Slideshow renderer.** `renderDneskaiReel(revision, audio)`: 1080 × 1920 MP4 from the approved 1080 × 1350 JPEGs
over a blurred copy of the slide, 3.5 s per slide, 0.5 s crossfade, gentle zoom, H.264 high, yuv420p, 30 fps, closed
GOP, AAC 128 kbps 48 kHz, `-movflags +faststart`, audio trimmed with a 2 s fade. First try: `ffmpeg-static` inside a
dedicated route with `maxDuration` 300 under Fluid Compute (check the Vercel plan limit first); if a 7-slide render
does not finish in time, move the renderer to a $2 a month Fly.io machine called by the same port. Output to the
public `marketing-media` bucket under a render key, kept with the revision. Unit test with a 2-slide fixture and
ffprobe.

**C2. Audio library.** Table `marketing_audio_tracks` (title, artist, source `meta-sound-collection` |
`pixabay` | `original` | `instagram-library`, licence note, source URL, storage path, duration, mood tags, enabled)
and a `marketing-audio` bucket. Owner uploads tracks in Zdroje → Hudba (Meta Sound Collection downloads are cleared
for Instagram; Pixabay Content License allows it; both are free). Lab: audio picker per post with a 10-second
preview, default rotation so two consecutive posts differ. `audio` joins the revision and the hash.

**C3. Publisher: Reels.** Extend the `reel` branch: `media_type=REELS`, `video_url`, `cover_url` = slide 1 JPEG,
`share_to_feed=true`, `caption`; poll `status_code` until `FINISHED` (video containers take longer; raise the poll
budget), then `media_publish`. Deck `format` gains `reel`; the Lab gets a Formát switch (Karusel / Reel) per post,
default reel for education and carousel for news. Reconciliation reads `media_type=REELS` too. One guarded live test
behind `MARKETING_DNESKAI_REELS_ENABLED`.

**C4. Facebook Login migration (owner decision, see section 6).** Add a second credential mode `facebook-login`:
the owner links a Facebook Page to @dneskai, the Meta app adds Facebook Login for Business with `instagram_basic`,
`instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_show_list`,
`pages_read_engagement`; the publisher resolves the IG user id from the Page and calls `graph.facebook.com`. Keep
Instagram Login as the fallback mode. Verify in Zdroje → Účet as today.

**C5. Trending audio (needs C4).** Daily step `audio-trends`: `GET /ig_audio?audio_type=music` and
`original_sound` without a query, store the day's list in `marketing_audio_trends` (audio_id, title, artist, first
seen, days seen), plus a 7-day ranking of `musicInfo.audio_id` over the tracked Instagram profiles from A2 and the
TikTok Creative Center Czech chart through `clockworks/tiktok-trends-scraper` (`adsSoundsCountryCode=CZ`, cents a
run). Zdroje → Hudba shows "Trendy zvuky" with cover art, artist and reuse signal; the Lab picker offers them next
to the library. Publishing a reel with a trending track sends `audio_configuration: { audio_id, audio_volume: 100,
video_volume: 0 }` on a silent MP4. Flag `DNESKAI_AUDIO_TRENDS_ENABLED`.

**C6. Manual music fallback (no C4).** While on Instagram Login, Publikované shows an "Přidat hudbu v aplikaci" badge
on carousels with a copyable track name from the trending list, so the owner can use Instagram's Replace Audio in
the app in 30 seconds. Documented, no code beyond the badge.

### Epic D: the simpler DNESKAi workspace

**D1. Tabs.** `DNESKAI_WORKSPACE_TAB_ORDER` becomes review ("Dnes ke schválení", default), calendar ("Kalendář"),
posts ("Příspěvky": the former Seznam list merged with Publikované receipts, filter chips Vše / Publikované /
Naplánované / Čeká), sources ("Zdroje"). `dneskai-costs` leaves the tab strip and opens from an overflow button
(`⋯`, lucide `Ellipsis`, Radix Popover, items: Chyby a náklady, Účet Instagram, Obnova témat, Klávesové zkratky) as
a dialog. Rename `dneskai-published` to `dneskai-posts` only if a migration of `user_preferences_hidden_project_tabs_check`
is cheap; otherwise keep the id and change the label. Update `project-tab-visibility`, `user-preferences`,
`project-tabs-database` and the e2e specs listed in section 8.

**D2. Lab sub-tabs by channel.** Replace Lab / Seznam with Instagram / Threads / LinkedIn (Threads and LinkedIn
disabled with a tooltip "Účet zatím není připojen"). Issue #124 stays the Threads backlog.

**D3. Remove the project header.** In `project-workspace.tsx` drop the `PageHeader` block (lines 241 to 247: back
button, "Hlavní projekt" eyebrow, summary, "Aktivní" badge) for every project workspace; the toolbar breadcrumb
"Projekty › DNESKAi" and the search button carry the context. Keep `globals.css:361-374` consistent.

**D4. Lab chrome.** Remove the "Design Lab" heading and intro, the version chip (the hash stays in the approve dialog),
the "Sada" label and both kit help texts, the recovery line (moved to the overflow menu), the Účet select (one
account, hardcoded label in the approve dialog only), the Klávesové zkratky button (overflow menu), and the post
title in `stage.tsx:53`. "Obnovit" becomes an icon button (`RefreshCw`, `aria-label`, tooltip).

**D5. State as card tint, dates as DD/MM.** Remove `StateChip` from cards. Tint the card by state with the soft
tokens: published `bg-success-soft`, scheduled and approved `bg-information-soft`, review and returned
`bg-warning-soft`, problem `bg-risk-soft`, preparing and skipped `bg-surface-muted`; keep the state in `aria-label`
and in a tooltip so colour is not the only carrier. Add one `formatDneskaiDay(date)` helper → `DD/MM` and use it
in the Lab, Kalendář, Příspěvky and Chyby a náklady; day headers in Dnes ke schválení show only Dnes / Zítra.
Regenerate the macOS visual baselines in `e2e/dneskai-lab-visual.spec.ts-snapshots/`.

**D6. Zdroje as a source list.** Zdroje shows two lists, Instagram profily and Weby, each row: handle or domain,
kind chip (news / education), tier, weekdays, last read, items last night, toggle. Add and remove rows; the registry
in `dneskai-registry.ts` becomes the seed, the rows live in a table `marketing_dneskai_sources` (migration). The
account panel, recovery actions and the research panel move under the overflow menu. Seed the new sources from
section 5.

### Epic E: operating rules for Opus

**E1. Commit cadence.** The owner grows a GitHub contribution graph during a job search. Opus commits after every
coherent step that passes `tsc` and the touched tests, at least one commit per hour of work and never a single
end-of-task commit; subject in the imperative, body says what and why, ends with the Co-Authored-By line. One branch
per issue named `opus/<issue-number>-<slug>`, pushed at the first commit and after each later one (the owner
authorises pushing for these issues in the issue text itself), one PR per issue linking the issue, merged with a
merge commit (no squash) once CI is green. Each PR also updates the relevant doc under `docs/` and, where a new
owner action appears, `NEEDED.md`.

**E2. Done means.** Lint, `tsc`, vitest, build and the touched e2e specs pass; EN/CS parity; mobile width and axe on
changed screens through `/dev-preview`; a flag for every behaviour change; migration documented in
`docs/migration-guide.md` and listed as unapplied; `docs/SYSTEM-MAP.md` updated when a step, table or outside system
is added.

## 5. Sources and ideas to seed

The full bank with 40 web ideas, the @itstundeanthony table and the owner-library summary is in
[the idea bank](2026-10-22-dneskai-idea-bank.md). The seed for `marketing_dneskai_sources` (D6) and the first weeks of
Náměty:

**Instagram profiles, kind `education`** (added to the ten news profiles already in `dneskai-registry.ts`):
@itstundeanthony (FACT or HYPE, Claude Code skills), @godofprompt, @rowancheung, @mreflow, @bensbites, @futurepedia,
@therundownai, @czechcrunch, @aimanie, @digitalnihumanista. Each read daily at `maxItems` 10 under the existing caps;
the last two need a manual check in the app first.

**Websites and feeds, kind `education`:** https://www.anthropic.com/news, https://code.claude.com/docs/en/whats-new,
the Claude app release notes (support.claude.com article 12138966), https://releasebot.io/updates/openai/chatgpt
(help.openai.com answers 403 to fetchers), the Product Hunt daily leaderboard, Show HN through the Algolia API
(`tags=show_hn`, points over 200), the monthly GitHub trending AI roundup on dev.to, https://www.bensbites.com/,
https://aisdg.substack.com/, https://www.perplexity.ai/changelog, https://webcrew.cz/ (Czech monthly), 
https://cc.cz/umela-inteligence/.

**First twenty Náměty to propose** (owner still approves each): write your own skill in 20 lines (SKILL);
Cowork runs with the laptop closed (COWORK); Claude in Google Docs, Sheets and Slides (WORKSPACE); memory you can
edit (PAMĚŤ); Max plan API credits (KREDITY); Superpowers plugin (SUPERPOWERS); Caveman skill, 65 % fewer tokens
(CAVEMAN); brag, a video of your repo (BRAG); pricing-strategy skill (CENA); Gemini Skills replace Gems by 17
November (GEMS); Google Deep Review, two free contract reviews a week (REVIEW); Gemini Notebook review step
(NOTEBOOK); ChatGPT audio uploads (AUDIO); locked chats (ZÁMEK); three dictation apps that work (DIKTOVÁNÍ);
OpenScreen v2 (SCREEN); Notion 3.8 MCP (NOTION); Shoptet MCP (SHOPTET); MCP for non-programmers (MCP); the
anti-hallucination prompt STATED / INTERPRETATION / UNSUPPORTED (FAKTA). HYPE candidates worth a "what not to buy"
post: Claude Duet (waitlist), Dots (EEA excluded), Meta Muse Wonder, OpenClaw for non-coders.

## 6. Owner decisions, made 22 October 2026

The owner answered yes to every recommendation on 22 October 2026:

1. **Facebook Login migration (C4): yes**, after C1 to C3 have published one Reel with library audio.
2. **Posts per day:** 1 news + 1 education by default.
3. **Keyword CTA on education posts only.** News posts keep the calm register and no keyword.
4. **Public reply under the matched comment: yes**, one short line, editable per post in the same Lab card where
   the deck, caption, keyword and DM message are edited (B3).
5. **Tab id stays `dneskai-published`**; only the label changes to "Příspěvky".
6. **Project header removed for every project workspace.**
7. **Transcripts for FACT or HYPE reels: yes**, capped at 10 a night.

## 7. Sequence

Week 1: A1 to A5, D1 to D5, B1 to B3 (schema and UI, no outside calls). Week 2: A6, A7, B4, C1 to C3, D6, E
applied throughout. Week 3: B5, B6, C4 to C6 after the owner's decision. Owner actions along the way: apply the
migrations with `npx supabase db push --linked`, flip the flags, upload the first audio tracks, Meta app settings for
webhooks and Facebook Login.

## 8. Tests Opus must expect to touch

`tests/components/project-tab-visibility.test.tsx`, `tests/lib/user-preferences.test.ts`,
`tests/lib/project-tabs-database.test.ts`, `tests/components/dneskai-workspace-tabs.test.tsx`,
`tests/components/workflows-panel.test.tsx`, `tests/lib/marketing-contracts.test.ts` (schema JSON equality),
`tests/lib/migration-contracts.test.ts`, `e2e/dneskai-workspace.spec.ts`, `e2e/dneskai-sources.spec.ts`,
`e2e/dneskai-lab.spec.ts`, `e2e/dneskai-lab-visual.spec.ts` (baselines), `e2e/dashboard.spec.ts:128-132,278-280`.

## 9. Research notes and sources

- Instagram Audio API, Facebook Login only, trending by default:
  https://developers.facebook.com/docs/instagram-platform/content-publishing/audio-api/
- REELS spec, `cover_url`, `share_to_feed`, `audio_name`:
  https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
- Carousels: no music parameter, "Reels cannot appear in carousels":
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
- Private Replies (one per comment, 7 days, scopes):
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/private-replies
- Comment moderation and `/replies`:
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/comment-moderation
- Webhook fields and delivery modes: https://developers.facebook.com/documentation/instagram-platform/webhooks/setup ,
  https://developers.facebook.com/docs/development/build-and-test/app-modes
- Standard Access is enough for an account you manage: https://developers.facebook.com/docs/instagram-platform/overview
- Music guidelines and muting: https://about.instagram.com/blog/announcements/updates-and-guidelines-for-including-music-in-video
- Publishing quota (50 per 24 h in the limit reference):
  https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
- Hashtag cap of five (press on the @creators post): https://betanews.com/2025/12/19/instagram-puts-a-limit-on-hashtag-usage/
- Reel scraper `musicInfo` fields and price: https://apify.com/apify/instagram-reel-scraper
- TikTok Creative Center sounds with a CZ filter: https://apify.com/clockworks/tiktok-trends-scraper
- Instagram audio catalogue with reuse counts: https://apify.com/seemuapps/instagram-music-scraper
- Vercel function size and Fluid Compute limits: https://vercel.com/docs/functions/limitations ; Fly.io pricing:
  https://fly.io/docs/about/pricing/ ; Remotion licence: https://www.remotion.dev/docs/pricing
- Reach by format under 50k followers (Metricool/HypeAuditor 2025, Fanpage Karma):
  https://www.fanpagekarma.com/insights/instagram-format-reach/
- @itstundeanthony sample: Apify run `z2kbeg9nMs84cqahR`, dataset `SbAdmR1IdgNue1LG0`, 80 posts, about $0.18.
- Repository inventory: `docs/SYSTEM-MAP.md`, `src/lib/marketing/publisher.ts`, `dneskai-briefs.ts`, `scheduler.ts`,
  `src/lib/project-workspace-tabs.ts`, `src/components/marketing/dneskai/lab/`, `src/lib/i18n/sections/dneskai-lab.ts`.
