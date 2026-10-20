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

DNESKAi has a registry of 42 sources, with daily sources and rotating day groups.
The prepared n8n schedule starts at 22:00 Europe/Prague and continues every five
minutes until 23:55, targeting up to four distinct next-day research topics.
Daily collection remains disabled. The completed bounded production collection
stored 70 candidates and selected zero of four topics. Jev evaluates relevance
and duplicates; wider editorial evaluation remains tracked in
[#108](https://github.com/lukaskourilcz/own-dashboard/issues/108).
The web keeps its single daily BoardlessAI article and existing delivery path.
Socials can cover more research topics; collecting them does not create extra
web articles. Selected events become social briefs and generation jobs in
OwnDashboard without an article ([events and briefs](dneskai-briefs.md), #115);
an approved article remains a valid source. Source/template
approval does not approve exact final copy, graphics, account or publication
time. The guide does not claim that source-port work in #104 has cut over.

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
