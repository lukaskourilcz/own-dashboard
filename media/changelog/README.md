# Changelog captures

One authentic screenshot per changelog feature, committed next to this file and
referenced from `src/lib/changelog.ts` (which generates `CHANGELOG.md`).

Every capture comes from the real UI on `/dev-preview`, rendered against the
deterministic demo fixtures. No generated UI, no mockups, no placeholders. A
feature with no capture yet keeps `media: null` in the module and simply ships
without an image — that is the deferred state, not a failure.

## How to capture

The capture suite is opt-in so an ordinary `npm run test:e2e` can never rewrite
committed binaries:

```bash
npx playwright install chromium   # only if no browser is installed yet
CHANGELOG_CAPTURE=1 npx playwright test e2e/changelog-capture.spec.ts --project=desktop
```

Skip the install line in the Claude Code cloud environment. The browser is
preinstalled at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`), and
`npx playwright install` is disabled there. `npx playwright install --dry-run
chromium` prints the revision directory the installed Playwright expects; for
`@playwright/test` 1.56.1 that is `chromium-1194`, which is present.

`e2e/changelog-capture.spec.ts` is the list of captures. Add a case there, run
the command, look at the PNG, then point the matching `ChangelogFeature.media`
at the file, write the alt text from what the image shows, and regenerate
`CHANGELOG.md`.

A green run is not proof of a usable image. Each case therefore names the panel's
own `PageHeader` title, a control only that panel renders, and, where the
panel loads on request or hides the feature behind a disclosure, the button to
press first. Career loads nothing until **Check for new offers** is pressed. `AppToolbar` renders an `h1` for every tab above the panel, so a toolbar
heading proves nothing about what is in frame. Two panel titles differ from
their sidebar label: the Money overview tab's panel is headed "Development
finance".

## Conditions every capture is taken under

| Setting | Value |
|---|---|
| Route | `/dev-preview` (the same fixtures `/guest` serves) |
| Viewport | 1440 × 900 (`--project=desktop`) |
| Language | English (`gotoPreview` forces `lang=en`) |
| Theme | Light (`gotoPreview` forces `theme=light`) |
| Motion | Reduced, plus an explicit settle wait for recharts, which animates on mount through `requestAnimationFrame` and ignores `prefers-reduced-motion` |
| Scope | The `#main-content` element: the toolbar, the sidebar that overlays its left padding, and the visible part of the scroll area |

An element screenshot does not scroll, and the scroll area is about 808 px tall
at this viewport, so anything below that fold is out of frame. A feature whose
evidence sits further down names the element to scroll into frame first
(`scrollTo`, with `scrollBlock` when it should be centred), as the Tools and
Settings captures of 2026-09-26 do, rather than taking a taller capture. A
panel that repeats its buttons on every row is identified by a named group
(`controlRole: "group"`) instead of a button.

## Naming

`<entry-date>-<feature-slug>.png`, for example `2026-09-25-competition.png`.
The date is the entry's date, so the files sort the way the entries do.

## Alt text

`ChangelogMedia.alt` describes what the capture shows, not that it is a
screenshot. It is what a reader gets on GitHub when images do not load.
