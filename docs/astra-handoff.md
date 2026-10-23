# Astra handoff: browser tasks for DNESKAi

Written 23 October 2026 for Codex Astra, working in Lukáš's Chrome. All code from the education, keyword-DM and
Reels plan (#150–#175) is merged to `main` and deployed. Every new feature is off. Turning features on and wiring
them to Meta is browser work, listed here in the order it can be done. Each task is a GitHub issue labelled `astra`
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

## Verified browser progress — 23 October 2026

This status supersedes the initial “every feature is off” and migration-waiting descriptions above. Lukáš explicitly authorised the agent to push migrations, use his signed-in EU LangSmith account, and perform the exact #184 cleanup. Secrets are omitted. Read the latest issue comments before continuing.

- **Database / #178:** all 23 migrations through `20261023130300` applied successfully to Production (`gcctapykhrdyxikieemn`) using the Supabase CLI from main commit `30982f6cd19418f4bf9f155d0b8159309ee4fc98`. A second dry run reported up to date. All seven new public tables have RLS enabled; `marketing-reels` and `marketing-audio` buckets are private; scheduler-pruning cron exists. Do not push this batch again.
- **#178:** the editor and all 12 routine phase-1 switches listed above are set in Production. Cleanup and the 12-switch batch were deployed together: `6xLiVF6oFxoht6VZYCyRz9nzTfGu`, Ready / Current, 23 October 12:09 CEST. Account reverified at 12:10; replies ON, publishing OFF. Fact-or-hype, TikTok, titling/topic briefs and audio trends remain off for the choices/dependencies above. Issue stays open.
- **#184 CLOSED:** three named retired n8n credentials deleted; all 59 Preview variables scoped to `codex/marketing-automation` deleted; Production manual-run, manual-secret and collection-secret variables deleted. The two listed Production n8n webhook variables were already absent. No workflows, Supabase branches or ledgers deleted. Full names are in the issue comment.
- **#185 CLOSED:** profile findings are in the issue; both candidate sources remain disabled.
- **#180:** owner confirmed mobile message access is enabled. Account verification and replies are ready, but neither of the two recent published posts has a keyword: **no keyword post yet**. No test comment or DM sent. Needs a suitable published post and an owner-named second account.
- **#183:** signed-in EU LangSmith workspace `Workspace 1`; created `dneskai-production` agent with a Local tracing environment. Base retention is 14 days (shortest offered). Scoped Service Key dialog is prepared but unsubmitted. No key generated, no LangSmith Vercel values set, tracing still off. Confirm the app’s `LANGSMITH_PROJECT` maps to the intended EU tracing project before enabling traces.
- **#179:** Meta app remains Development/unpublished. Current Instagram API setup says webhook reception requires the app to be published, contrary to the earlier Development-mode expectation. Callback URL drafted only; verification token/app secret not installed, callback unverified, comments not subscribed. Resolve this requirement before claiming webhook readiness.
- **#182:** library still empty. Meta Sound Collection requires owner acceptance of its Terms of Use. Pixabay alternative was researched; Download for Technology by AtlasAudio (1:12) was blocked by Chrome at `cdn.pixabay.com` (`ERR_BLOCKED_BY_CLIENT`) before saving a file. No protection bypass, track upload or Reel publication occurred. Source: https://pixabay.com/music/beats-technology-613340/ .
- **#181:** waits for the first Reel with library music and an owner-named Facebook Page. No Facebook Login migration/token change performed.

Remaining live Chrome tabs are prepared for EU LangSmith key creation, Meta webhook setup, music terms/download access, and the OwnDashboard account/library. New credential/access grants and binding terms require action-specific consent or an owner click; do not treat this status as that consent.
