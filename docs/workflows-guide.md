# Workflows guide

Issue: [#103](https://github.com/lukaskourilcz/own-dashboard/issues/103).

`/workflows` uses the existing authenticated catch-all route, persistent shell,
History API, sidebar, mobile More sheet and command palette. The page loads no
dashboard entities, requests no marketing data and makes no model calls.
`WORKFLOW_AREAS` covers every visible canonical destination except the guide itself.
Inbox, References and retired personal areas remain outside navigation.

The managed English and Czech copy follows the embedded Humanizer 3.1.0 skill
at `templates/marketing/humanizer/SKILL.md`. Its upstream file and provenance are
unchanged. The guide does not import the social-copy runtime adapter. The product,
design-system, visual-QA and Stop Slop workflows informed the implementation.

Seven diagrams use managed strings, semantic figures and ordered lists. The same
text is available to screen readers. Mobile stacks steps vertically; desktop
shows arrows between steps. There is no HTML injection, external diagram service
or diagram script evaluation. Destination links retain real URLs and modified-click
behavior while ordinary navigation uses the existing shell.

## State represented on 14 October 2026

Core professional areas and Workflows are deployed. Production is READY at merge
`d896d5b` (PR #109); the guide remains versioned explanatory content. Connections
still depend on owner setup. Marketing remains a pilot. The first week's assets
are ready offline; live staging import awaits verification and exact post approval.
The paid generation pipeline's three admitted jobs produced no finished stored draft;
another paid attempt needs a new owner-approved allowance. Preview headline/image
selection does not authorize production magazine delivery.

DNESKAi changed after this date; see the DNESKAi section below.

The Sunday devShark plan covers seven days, with one Instagram feed post,
two Threads posts and three Stories per day. Prepared offline assets still need
verified live import and exact owner approval. Later dates remain backlog.
Scheduled generation and publishing remain disabled; Instagram analytics and the
independent Threads connection require their own consented access.

Weekly Results uses the loaded publication/revision sample for seven days of
scheduled slots. It does not infer actual publication timestamps or complete weekly
coverage. Reach, saves, shares and replies remain uncollected. Missing measurements
never become zero values or performance gains. Tiny samples cannot establish a
winning format. Recent Saved acquisition is deferred under
[#101](https://github.com/lukaskourilcz/own-dashboard/issues/101).

## DNESKAi on 21 October 2026

Scheduling runs in Supabase ([marketing scheduling](marketing-scheduling.md), #120).
pg_cron calls `POST /api/marketing/tick` every five minutes and once a day, and a
tick runs at most one unit of work per step. After 22:00 Europe/Prague it collects
the free news feeds directly (`MARKETING_DNESKAI_FEED_PROVIDER=native` in
Production; the Quorum bridge is the rollback), and continues every five minutes until
the run is finished.

Events come only from Jev, the paid TypeSafe classification of relevance and
duplicates. It runs only while `MARKETING_AI_CONSENT` and
`MARKETING_DNESKAI_PAID_ENABLED` are `true` and `TYPESAFE_API_KEY` is set; the same
switches also gate the paid Apify Instagram sources. Without Jev the feeds are still
collected, but the run ends `partial` (with `collection-classification-pending`
while new items wait): no event is selected and no brief, generation job or post
is made. With it, up to four selected events get their source pictures and a brief
([events and briefs](dneskai-briefs.md), #115), and once `@dneskai` is verified
one generation job each. Claude Sonnet
writes the copy and the carousel studio renders the slides. The owner reviews
each exact post in the DNESKAi project's „Dnes ke schválení“ (“For review today”)
tab. A post is published only after that exact approval and only while both
publish switches and the account's own switch are on.

While `MARKETING_DNESKAI_COLLECTION_ENABLED` is not `true`, collection, media and
briefs are a recorded skip that costs nothing; without `MARKETING_AI_CONSENT`
generation is skipped the same way. Publishing is never skipped: while either
publish switch is off, each due slot gets a dry run with no Meta write. Collection
runs every night since 21 October. The pilot
([#123](https://github.com/lukaskourilcz/own-dashboard/issues/123)) published two
posts on 22 October; since then the account switch is off, so a due slot holds
without a Meta write.

The DNESKAi n8n workflows are retired
([retired exports](../workflows/marketing/retired/README.md)). By the owner's
decision of 20 October 2026 ([quorum#602](https://github.com/lukaskourilcz/quorum/issues/602))
DNESKAi articles are paused: BoardlessAI
writes no DNESKAi article, and the posts come from the news collection alone.
The completed bounded production collection stored 70 candidates and selected
zero of four topics. Wider editorial evaluation remains tracked in
[#108](https://github.com/lukaskourilcz/own-dashboard/issues/108). Selecting an
event approves nothing; the owner approves the exact rendered revision, including
its copy, graphics, account and publication time.

This is versioned explanatory content with an explicit verification date, not a
live operational status monitor. Future implementation changes must update both
translations. Current handover and remaining work are linked through
[#102](https://github.com/lukaskourilcz/own-dashboard/issues/102).

## Validation

The 14 October completion audit passed 19 scoped Vitest checks across the guide,
canonical navigation and route data. Scoped ESLint and `git diff --check` passed.
The Playwright production-fixture build succeeded and all six Workflows browser
checks passed across desktop/mobile and EN/CS. These checks cover the direct
unauthenticated route, History back/forward, keyboard links, mobile More navigation,
no marketing requests, and reflow at 360, 430, 768, 1024, 1440 and 1728 pixels.
Axe reported no WCAG 2A/AA, 2.1A/AA or 2.2AA violations in English/light and
Czech/dark views. Managed ordered lists provide the diagrams' screen-reader text.
A read-only production request to `/workflows` returned the expected 307 to login.

Authentic screenshots refreshed by that run are
`/tmp/own-workflows-{en,cs}-{desktop,mobile}.png` and
`/tmp/own-workflows-marketing-{en,cs}-{desktop,mobile}.png`. The Czech mobile
marketing view was visually inspected; the longer hold text wraps within the viewport.

The parent verified the deployed PR #109 baseline: 1,398 unit tests passed with one
intentional skip; full browser suite: 126 passed and 70 configured skips.
These baseline results precede this prose correction. The integration release
must run its required combined checks before deploying the correction. The
Workflows acceptance does not establish a completed live marketing pipeline.

Combined audit verification after the web/social clarification: 1,427 unit
tests passed (one configured skip), 126 browser tests passed (70 configured
skips), plus lint/types/build. This source correction is on the audit branch
until reviewed and merged; it is not a claim of production activation.
