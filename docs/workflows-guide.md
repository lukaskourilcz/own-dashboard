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

## State represented on 13 October 2026

Core professional areas are available. Connections remain subject to owner setup.
Marketing is a pilot. The first week's assets are ready offline, using deterministic
rendering without another model call; staging import is in progress. This does not
grant approval to the posts. The paid pipeline's three admitted jobs did not produce
a finished stored draft; another paid attempt needs a new owner-approved allowance.
DNESKAi has fourteen real held reviews and no approved final article source.
Preview headline/image selection does not authorize production magazine delivery.
Three new n8n workflows are saved as inactive drafts with placeholder connections.
Publishing and live scheduled generation remain disabled. Instagram analytics and the
independent Threads connection need their own consented access.

The requested Sunday devShark plan covers seven days, with one Instagram feed post,
two Threads posts and three Stories per day. The guide labels preparation as work
in progress: prepared offline assets still need import and exact owner approval.
Later dates remain backlog. DNESKAi requires a timely final BoardlessAI article
each day, with the owner's genuine headline and image selection. The guide
separates source/template approval from
approval of exact final copy, graphics, account and publication time. Weekly
engagement observations cannot establish a winning format from a tiny sample.
Weekly Results uses the loaded publication/revision sample for seven days of
scheduled slots; it does not infer actual publication timestamps or complete weekly
coverage. Reach, saves, shares and replies remain uncollected. Missing measurements
never become fabricated zero values or performance gains.
Recent Saved acquisition is deferred under [#101](https://github.com/lukaskourilcz/own-dashboard/issues/101).

This is versioned explanatory content with an explicit verification date, not a
live operational status monitor. Future implementation changes must update both
translations. Current handover and remaining work are linked through
[#102](https://github.com/lukaskourilcz/own-dashboard/issues/102).

## Validation

Content review after the seven-day scope update: four guide tests and scoped
ESLint passed. The guide and weekly-results tests together passed eleven checks;
the follow-up guide assertions cover both languages, daily quotas, offline/import
boundaries, inactive workflow drafts, timely DNESKAi sources, backlog and missing
engagement measurements. The earlier route and visual checks below cover the
original Workflows implementation in `5aa26a1`; this prose-only update does not
claim a new deployment or rerun of those browser checks.

- Scoped Vitest: 19 passed across the guide, canonical navigation and route data tests.
- Scoped ESLint and whole TypeScript check passed.
- Playwright: six checks passed across desktop/mobile and EN/CS, including direct
  unauthenticated route protection, History back/forward, keyboard link navigation,
  mobile More navigation and no marketing requests.
- Reflow checked at 360, 430, 768, 1024, 1440 and 1728 pixels. Axe found no WCAG
  2A/AA, 2.1A/AA or 2.2AA violations in English/light and Czech/dark views.
- Authentic local screenshots: `/tmp/own-workflows-{en,cs}-{desktop,mobile}.png`
  and `/tmp/own-workflows-marketing-{en,cs}-{desktop,mobile}.png`.

The parent integration runs the combined full suite and production build after
the shared work is committed. These scoped results do not claim a deployed
Workflows page or a completed live marketing pipeline.
