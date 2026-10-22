# DNESKAi Design Lab prototype

The project's review tab now opens the Lab. A List control retains the previous review surface. Calendar, Sources, Published and Errors and costs keep their existing reads. The prototype uses the existing `dneskai-review` tab identity, preserving hidden-tab preferences; it does not require a tab migration.

Open `/projects/<project-id-or-slug>?projectTab=dneskai-review&labPost=<revision-id>&labSlide=0`. Slide indexes are zero-based. The preview equivalent is `/dev-preview?project=dneskai&projectTab=dneskai-review`; query selection survives reload. `tab` remains the application shell's parameter, so the project selection is namespaced as `projectTab` rather than overloading it.

The queue shows today and tomorrow in Prague time, with jobs, deadlines and explicit states. It initially selects a post waiting for review. The stage shows the saved revision at 390 CSS px (or the available phone width), a 3:4 profile crop and a scrollable full-size JPEG. Missing renders remain visible states. Thumbnail loads must succeed before approval. An edited draft is labelled separately: saving creates a successor revision and the Lab follows that revision before approval becomes available.

The inspector reuses field counters, media-pool swapping and the focal picker. Crop arithmetic is pinned to the vendored renderer; fit feedback calls the existing owner-scoped, rate-limited fitter after a 300 ms debounce. It makes no model call. Caption, alt text, scheduled time and verified account edits retain the existing edit contract and exact-hash semantics. The hashed fields are listed in [marketing-revision-media.md](marketing-revision-media.md#approval-hash); state kept on the revision itself changes its hash. Sources stay read-only. Returned posts can be edited manually. The old List editor retains its existing ordering/removal controls; adding slides and changing type/variant are outside this prototype's edit contract.

Unsaved changes block approval, batch approval, refresh, List switching and return/skip actions. Switching to another post asks whether to discard changes; leaving the document triggers the browser's unsaved-change prompt. Ordinary project-tab navigation uses the existing application shell. Keyboard accelerators work outside text inputs: J/K or up/down selects posts, left/right selects slides, E focuses the first field, A approves, D opens batch confirmation, R returns with a note, S opens skip confirmation, G changes profile view and ? opens help. Radix handles dialog focus and Escape.

Approve the day captures the eligible revision IDs and hashes when its dialog opens. It shows each deck, caption, account and time; every image must load before submission. The request binds each hash independently and shows per-item refusals. A failure never grants authority to a different revision. Batch failures refresh the read because a response may be lost after some approvals succeeded. Individual approvals use the existing server route and hash check.

All five kits render (vendored Quorum `8135cc5`): Editorial, Bold, Explainer, Magazine and Ticker. A kit tile or the keys 1 to 5 switch the draft's kit; the stage then shows every slide as an unsaved preview in that kit, and saving writes a revision whose deck names the kit (`kit`, left out for Editorial so older hashes stand). That revision needs its own approval. A kit the vendored studio does not register is shown, never offered, and the server refuses it with `kit-unavailable`. Alternative-variant storage and retention stay out of scope. No approval hash is weakened, no schedule moves automatically, and no model call or notification is added.

## Expired time and Publish now (22 October 2026)

The server refuses an edit whose time is not in the future or is more than six days ahead (`schedule-outside-asset-window`). A post opened after its time has passed therefore starts with the nearest possible time, at least 15 minutes ahead on a 5-minute mark (`dneskaiNextEditableTime`). A note under the time field names the original time. The editor checks the six-day window before sending.

**Publikovat hned** (Publish now) appears on a DNESKAi post in review. It is enabled only when the saved slides have loaded, no blocking state applies and the account publishes: verified, its own switch on, and both server switches true. It also works when the draft differs only in its time. The confirmation dialog shows the title, `@account`, the number of slides, the version hash and the full caption. On confirmation, `POST /api/marketing/revisions` with `action: "publish-now"` and the shown `expectedHash`:

1. refuses unless that hash is still the revision's hash and the revision is `review` and ready;
2. refuses with `publishing-disabled` unless `MARKETING_PUBLISH_ENABLED`, `MARKETING_DNESKAI_PUBLISH_ENABLED` and the account's `enabled` are all true;
3. saves a new revision with the same caption, deck and account and a time two minutes ahead (`DNESKAI_PUBLISH_NOW_LEAD_MS`), reusing the re-verified JPEGs instead of rendering;
4. approves that revision's new hash through `marketing_approve_revision`.

The pg_cron tick, every 5 minutes, publishes the queued publication, usually within 7 minutes. The request never calls Meta itself: a carousel's container polling can take minutes, longer than a request may run.

## Authentic preview assets

`node scripts/dneskai-preview-fixtures.mjs` deterministically regenerates six abstract synthetic source images and sixteen full-size 1080 × 1350 JPEG slides with the vendored studio. The images and all copy are fixtures, not observations or source claims. Their originals are committed so the fixture renderer can verify each sha256 before rendering an edit.

`POST /api/dev-preview/dneskai-render` accepts a bounded deck using only those known fixture hashes. It reads no owner records, fetches no URL, calls no provider and writes no storage. It refuses cross-origin requests and unknown assets. Ordinary production answers 404; development and explicit `NEXT_E2E=1` builds can render fixture edits. The guest tour in an ordinary production build does not gain this rendering endpoint; a render-dependent demo edit is unavailable there. The public `/guest` Lab is explicitly read-only: edit/approval/List controls are disabled and it calls neither fit nor render endpoints. Dev-preview post edits and approvals remain in browser memory.

The preview also exposes the five specimen sheets, `public/demo/dneskai/kit-<kit>.png` with their JSON receipts: Editorial from Quorum commit `138422c9`, the other four from `8135cc5`. Each contains the six ADR fixture decks, 24 slides. Only Editorial refuses the low-resolution cover, because only its cover bleeds the picture.

## Verification

The focused route/read-model/component suite passes 21 tests, including a real fixture re-render when a saved version has no attached assets and no deck changes. Eight browser checks cover EN/CS, desktop/mobile, light/dark, dirty navigation, free fitting, real new pixels after save, exact-version approval and batch outcomes; the EN/CS flows include axe scans and clean console/network assertions. Six additional desktop-browser checks exercise 360, 430, 768, 1024, 1440 and 1728 px, full-size viewing and deep-link reload. Full repository gates and final integration results are recorded in the handoff LOG.md.
