# Astra handoff: browser tasks for DNESKAi

Written 23 October 2026 for Codex Astra, working in Lukáš's Chrome. All code from the education, keyword-DM and
Reels plan (#150–#175) is merged to `main` and deployed. The current status at the end records enabled features and remaining blockers.
The original execution order below covers browser setup and Meta integration. Each task is a GitHub issue labelled `astra`
in `lukaskourilcz/own-dashboard`; the issue and its comments hold the full steps. Read the issue before you start it.

App: https://own-dashboard-tau.vercel.app → Projekty → DNESKAi. The workspace has four tabs (Dnes ke schválení,
Kalendář, Příspěvky, Zdroje) and a **⋯** button for Chyby a náklady, **Účet Instagram**, Obnova témat and Klávesové
zkratky. Older issue comments that say "Zdroje → Instagram account" or "Zdroje → Účet" mean **⋯ → Účet Instagram**.
Hudba is still a section of Zdroje.

## Rules

- Secrets (tokens, keys, app secrets) go only into the field they belong in (Vercel, Meta). Never write one in chat,
  a report, an issue comment or a screenshot description. Report "set".
- Publish nothing, buy nothing, create no account Lukáš did not name, delete only what an issue names.
- Stop and ask Lukáš at any login, 2FA, CAPTCHA, phone step, or a choice the issue does not cover.
- Vercel changes: team `lukas-kourils-projects`, project `own-dashboard`, Settings → Environment Variables, target
  **Production** only. After a batch of changes, redeploy the latest Production deployment once and wait for READY.
- When an issue is done, comment on it with what was done (names only, no values) and close it. Close #178 only when
  every switch it lists is set or Lukáš has said to leave it off.

## Phase 0: no prerequisites, can start now

1. **#185 Check two Czech Instagram profiles.** Look at @aimanie and @digitalnihumanista and report the facts the
   issue asks for. Follow, like and message nothing. They sit switched off in Zdroje until this report.
2. **#180 Allow DM access for @dneskai.** Instagram → Settings → Messages and story replies → Message controls →
   Connected tools → Allow access to messages. If only the mobile app has it, ask Lukáš to switch it on. The live
   check in the issue's comment waits for phase 2.
3. **#178, first switch:** `DNESKAI_ENGAGEMENT_EDITOR_ENABLED=true`. It needs no migration. Redeploy.
4. **#184 Delete the retired October staging leftovers.** Ask Lukáš once before deleting. Exactly the three n8n
   credentials and the Vercel variables the issue lists; leave the Supabase branch alone.
5. **#183 LangSmith.** Only if Lukáš says he wants traces and names the account.

## Phase 1: after Lukáš pushes the database migrations

Lukáš runs `npx supabase db push --linked` himself; 23 migrations, `20261022000000` to `20261023130300`. Wait until
he confirms it finished. Then set these in one Vercel pass (#178 and its comments) and redeploy once:

- `DNESKAI_RICH_EVIDENCE_ENABLED`, `DNESKAI_OWNER_RECOVERY_ENABLED`, `DNESKAI_LAPSED_RELEASE_ENABLED`,
  `MARKETING_PUBLICATION_REQUEUE_ENABLED`, `DNESKAI_SELECTION_V2_ENABLED`, `DNESKAI_REGENERATE_ENABLED`
- `DNESKAI_TOPICS_ENABLED`, then `DNESKAI_SCOUTING_ENABLED` and `DNESKAI_DAILY_MIX_ENABLED`
- `DNESKAI_SOURCES_TABLE_ENABLED`
- `MARKETING_DNESKAI_REELS_ENABLED`
- `DNESKAI_ENGAGEMENT_ENABLED`, and add `instagram_business_manage_comments` to
  `MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES` only if Meta's Access Token Debugger shows the token has it. After the
  redeploy: ⋯ → Účet Instagram → **Ověřit účet**, then **Zapnout odpovědi**.

Set `DNESKAI_FACT_OR_HYPE_ENABLED` only after Lukáš decides on its spend in `NEEDED.md` (paid transcripts, $0.50 a
day by default). Set `DNESKAI_TITLING_ENABLED` and `DNESKAI_TOPIC_BRIEFS_ENABLED` **only when Lukáš asks, and both together**:
titling stops the old automatic briefs, and topic briefs is what turns approved titles into posts.

## Phase 2: after phase 1

1. **#179 Comment webhooks.** Create `MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN` (random, 32+ characters) and
   `MARKETING_INSTAGRAM_APP_SECRET` in Vercel, redeploy, then add the callback
   `https://own-dashboard-tau.vercel.app/api/webhooks/instagram` and the `comments` field in the Meta app. Finish
   with ⋯ → Účet Instagram → **Odebírat komentáře**. Ask before switching the Meta app to Live.
2. **#182 Fill the music library.** Ten instrumental tracks from Meta Sound Collection or Pixabay Music, uploaded in
   Zdroje → Hudba → Nahrát skladbu with the fields the issue's comment lists.
3. **#180 live check.** Once a published post younger than seven days carries a keyword, comment the keyword from
   a second account Lukáš names and check that exactly one DM arrives.

## Phase 3: after the first Reel with library music is published

Lukáš publishes the first Reel himself and says when it is out.

1. **#181 Facebook Login.** Link @dneskai to the Facebook Page Lukáš names, add Facebook Login for Business with the
   scopes in the issue plus `pages_messaging`, create a long-lived Page token, set the Vercel values from the issue's
   comment, redeploy, then ⋯ → Účet Instagram → **Ověřit účet**. The issue has the rollback.
2. **#178, after #181:** `DNESKAI_AUDIO_TRENDS_ENABLED=true`, redeploy.
3. **#178, TikTok:** `DNESKAI_TIKTOK_TRENDS_ENABLED=true` only after Lukáš approves the spend in `NEEDED.md` (at
   most $0.10 a day).

## Report back

One comment per issue as above, and a short summary to Lukáš: what is done, what waits for him, and anything that
did not match the issue text.

## Verified browser status, 23 October 2026

This status supersedes the initial migration wait and earlier issue comments. Lukáš authorised the agent migration push, exact #184 cleanup, signed-in EU LangSmith key, Meta music terms and switching the Meta app to Live. Read current issue comments before continuing.

- **Database / #178:** all 23 migrations through `20261023130300` applied to Production (`gcctapykhrdyxikieemn`) through the Supabase CLI from main `30982f6`. A second dry run reported up to date. Seven new public tables have RLS enabled, Reel/audio buckets are private, scheduler-pruning cron exists. Do not repeat the push. The editor and all 12 routine phase-1 switches above are set. Account reverified; replies ON, publishing OFF. Fact-or-hype, TikTok, titling/topic briefs and audio trends remain off for the choices/dependencies above. #178 remains open.
- **#184 CLOSED:** deleted the three named retired n8n credentials, 59 Preview variables scoped to `codex/marketing-automation`, and three listed Production variables. Two listed n8n Production variables were absent. Workflows, Supabase staging branch and ledgers remain. Full names are in #184.
- **#185 CLOSED:** @aimanie was a Russian personal/lifestyle profile; @digitalnihumanista unavailable. Both sources remain disabled.
- **#180 OPEN:** owner enabled mobile message access, account verification and replies are ready. **No keyword post yet**: neither recent published post carries a keyword. Needs a suitable published post and an owner-named second account to check exactly one DM. No test comment/DM sent.
- **#183 CLOSED:** EU Workspace 1 Service Key created with workspace scope and 90-day expiry; `LANGSMITH_API_KEY` set as a Production Secret. `MARKETING_LANGSMITH_ENABLED`, `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT` set; native tracing/verbose variables unset. Deployment `8QmEdVuKH8pT31U787MQnmfyc6qi` Ready, main `b213653`, 23 October 12:34:28 CEST.
- **Tracing verified:** one pending-draft regeneration at 12:38 CEST produced one successful EU `marketing-generation` trace: No inputs / No outputs, source and owner-note hashes, bounded diagnostic metadata. One attempt, recorded model cost $0.013972 inside the existing $1 daily cap. Actual Production project is `2fe133a8-1bad-46aa-9646-0d9042726285`, under agent slug `dneskai-production-81726105`, Base 14-day retention. The earlier empty `dneskai-production` Local setup is unused; do not confuse it with the verified destination. New Anthropic Agent Skills draft remains unapproved in the Lab; nothing published.
- **#179 OPEN:** privacy prerequisite completed: `https://dneskai.vercel.app/privacy` is live, linked in the reader footer and sitemap; deletion instructions are at `#vymaz-udaju`. Implemented in `lukaskourilcz/aifirst` main `f9d04fe`, Production deployment `mY8an9snf3cUf97u5ixVaKFXphNL` Ready; 311 unit tests, 252 browser checks and production build passed. Saved and reloaded both URLs in Meta Basic settings. Owner-approved switch to Live completed; Meta confirmed Published and successful publication. This publishes the developer app, not Instagram content. Revealing the Instagram-specific app secret still requires the owner’s Facebook password; that dialog remains open. `MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN` and `MARKETING_INSTAGRAM_APP_SECRET` remain unset, callback unverified, comments unsubscribed. After the password step, finish secrets/deploy, callback/field, then Odebírat komentáře.
- **#182 OPEN:** owner approved Meta music terms. This visit showed the collection/Terms page without an acceptance control; no new acceptance was submitted. Filtered Electronic / Chill / No vocals / 30 secs–1 min; selected Good Morning, Giulio Cercato (0:59). Chrome blocked its download at `lookaside.facebook.com` (`ERR_BLOCKED_BY_CLIENT`); the supported browser download control also returned no file. Prior Pixabay download at `cdn.pixabay.com` was blocked too. Library remains empty. Resolve file delivery, then upload ten tracks with source/licence metadata. Do not request the same terms approval again.
- **#181 OPEN:** waits for the first Reel with library music and an owner-named Facebook Page. No Facebook Login/token migration performed.

`NEEDED.md` now records completed setup and remaining owner tasks. The Meta password dialog and completed public privacy page remain open. The policy/Live blocker is resolved; music-download access, first Reel and live keyword-DM prerequisites remain as above. Secret values are omitted; report “set”.
