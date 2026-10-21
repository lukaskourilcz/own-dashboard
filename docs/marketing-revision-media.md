# DNESKAi revisions with media and crop (#118)

An approval belongs to exact bytes, crops and text. A signed delivery URL is a temporary link to bytes the revision already names by hash, so renewing it needs no new approval. Every content change does.

## Revision shape

`ContentRevision` (`src/lib/marketing/contracts.ts`) has two versions:

- `marketing-content/1`: devShark and legacy DNESKAi article revisions. No `deck`.
- `marketing-content/2`: DNESKAi Instagram revisions from a brief. `deck` (`dneskai-slides/1`, `src/lib/marketing/dneskai-slides.ts`) is required. A `carousel` carries `deck.format: carousel` with 2–10 slides; a `post` carries `deck.format: single-image` with one `single` slide. Brand must be `dneskai` and the account Instagram.

The deck names each source image by `assetSha256` (the stored bytes in `marketing_media_assets`, #114) with its crop (`focal {x, y}`, optional `zoom`, `fit`). `assets[]` are the rendered 1080×1350 JPEGs, one per slide in slide order. Readiness holds a deck revision without assets (`deck-render-required`), with a different asset count (`deck-assets-mismatch`) or with non-JPEG assets.

## Approval hash

`revisionContentHash(revision)` in `src/lib/marketing/hashes.ts` is sha256 over the canonical JSON of the revision with `assets[].url` removed and nothing else. It covers title, caption, format, the deck (slide text, image hashes, crops, order), each asset's sha256, MIME type, dimensions and alt text, account, schedule, sources, collaborators, knowledge IDs and versions. It is what `content_hash` stores and what `approved_hash` binds. `revisionHash` is the same function under its old name.

SQL never computes the hash. `marketing_save_revision`, `marketing_approve_revision`, `marketing_claim_due` and the publication fences compare stored values only.

## URL renewal

`renewStoredRevisionAssetUrls(db, owner, revisionId)` in `src/lib/marketing/asset-urls.ts`:

1. reads a `review` or `approved` revision of the owner and checks that its stored hash is the URL-free hash;
2. re-downloads every stored JPEG, checks its proof metadata and that its sha256 equals `assets[].sha256`, then signs a seven-day URL for the same key;
3. calls `marketing_renew_revision_asset_urls(owner, revision, expected_hash, assets)`.

The SQL function (service role only) refuses unless the revision without URLs is identical, the asset count and order match, and each new URL is a signed `marketing-assets` URL for the same object path. It rewrites `revision.assets` only. `content_hash`, `approved_hash`, `status`, `ready` and the queued publication stay; no revision is created. The daily tick (#120, `renewal` in `src/lib/marketing/scheduler.ts`) runs it for revisions whose signed URLs expire within 48 hours. A revision that can never be renewed, such as one stored before #118, is set aside for a week.

## Owner edits

`POST /api/marketing/revisions` with `action: "edit"` takes `caption`, `scheduledAt`, an optional `accountId` (a verified `marketing_accounts` row of the same brand and platform) and, for a deck revision, an optional `deck` edit:

```json
{ "slides": [
  { "from": 1, "headline": "…", "body": null, "images": [{ "slot": "image-1", "assetSha256": "…", "crop": { "focal": { "x": 0.4, "y": 0.3 } } }] },
  { "from": 0 }
] }
```

`from` is the slide's index in the edited revision; entry order is the new order and an omitted slide is removed. A slide can change `headline`, `body` and `kicker` (`null` removes), `credit`, `alt` and the images of its existing slots (swap the asset, change the crop). Type, variant and sources stay as generated. The server refuses duplicate or unknown slides, changed slots, a carousel outside 2–10 slides, an invalid deck, and any image whose sha256 is not in the brief's media pool (`ListBriefAssetHashes`, `src/lib/marketing/dneskai-ports.ts`).

The flow (`src/lib/marketing/dneskai-revision-edit.ts`):

1. The route resolves the renderer, media loader and pool lister from `src/lib/marketing/dneskai-wiring.ts` before writing anything. If one cannot be created, the route answers 503 `renderer-unavailable`; if the pool or the media cannot be read while the edit is prepared, it answers 503 `media-unavailable`. Both happen before anything is written, and the current revision keeps its state. A failure carrying the legacy `renderer-unwired` or `media-unwired` code is passed through unchanged.
2. `prepareDneskaiRevisionEdit` applies and validates the edit and drops the old assets.
3. `saveRevision` stores the new revision with `replaces_id`, `status review`, `ready false`. The old revision becomes `superseded`, loses its approval and its queued publication is cancelled, so the old hash cannot be approved or published any more.
4. `renderAndAttachDneskaiRevision` calls `RenderDneskaiDeck` with `LoadDneskaiMediaBytes` and passes the result to `marketing_attach_revision_render`. A clean render attaches one JPEG per slide, stores the new `content_hash` and sets `ready true`. A refused or failed render keeps the revision unready with no assets and records the problems in `marketing_revisions.render_report`.

A generated revision gets its report from the job instead: the worker renders the deck inside the job and sends `renderReport` in the result, and `marketing_finish_job` (migration `20261021090000`) stores it on the revision it saves. A rendered result never carries a blocking problem; the worker refuses one as `dneskai-render-refused`.

The response is `{ id, ready, contentHash, render: { status, problems } }`. Legacy revisions keep the caption/schedule edit with renewed asset URLs; a deck edit on them is refused with `deck-edit-unsupported`.

## Approval and publication gates

`marketing_approve_revision` refuses a revision that is not `ready`, has a blocking render report (`render blocked`) or a deck whose asset count differs from its slides. The route returns `{ error: "approval-unavailable", reason }` with a reason code such as `revision-not-ready` or `render-blocked`.

`publicationGate` (`src/lib/marketing/publisher.ts`) recomputes `revisionContentHash` and requires `approved_hash` and `content_hash` to equal it, holds `render-blocked` for a report that is not a clean render, and keeps every earlier check: `MARKETING_PUBLISH_ENABLED`, `MARKETING_DNESKAI_PUBLISH_ENABLED`, the enabled verified account, schedule, sources and readiness. Before any container exists, `verifyAssets` downloads each asset from its current URL and compares the bytes' sha256 with `assets[].sha256`. The container intent is `intent:<content hash>`, so it is stable across a renewal.

## Tests

- `tests/lib/marketing-revision-identity.test.ts`: URL renewal keeps the hash; focal, zoom, fit, image swap, order, text, bytes, alt, account and schedule change it; the v1/v2 deck rule.
- `tests/lib/marketing-revision-media-database.test.ts` (PGlite): renewal keeps approval and publication; renewal changing anything but the signature is refused; an edit supersedes the approved revision and its approval cannot be reused; attach rules; approval holds.
- `tests/lib/marketing-dneskai-revision-edit.test.ts`, `tests/lib/marketing-revisions-route.test.ts`: edit operations, pool check, unwired refusal, render attach and refused renders with fakes.
- `tests/lib/marketing-publisher-media-identity.test.ts`: publication after renewal, held crop or text changes, blocking report, byte drift.
