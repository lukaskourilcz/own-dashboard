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
npx playwright install chromium   # once per machine
CHANGELOG_CAPTURE=1 npx playwright test e2e/changelog-capture.spec.ts --project=desktop
```

`e2e/changelog-capture.spec.ts` is the list of captures. Add a case there, run
the command, then point the matching `ChangelogFeature.media` at the new file
and regenerate `CHANGELOG.md`.

## Conditions every capture is taken under

| Setting | Value |
|---|---|
| Route | `/dev-preview` (the same fixtures `/guest` serves) |
| Viewport | 1440 × 900 (`--project=desktop`) |
| Language | English (`gotoPreview` forces `lang=en`) |
| Theme | Light (`gotoPreview` forces `theme=light`) |
| Motion | Reduced, so no frame is caught mid-transition |
| Scope | The panel or card in question, not the whole window |

## Naming

`<entry-date>-<feature-slug>.png`, for example `2026-09-16-competition.png`.
The date is the entry's date, so the files sort the way the entries do.

## Alt text

`ChangelogMedia.alt` describes what the capture shows, not that it is a
screenshot. It is what a reader gets on GitHub when images do not load.
