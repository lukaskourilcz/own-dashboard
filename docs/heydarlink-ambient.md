# HeyDarlink ambient photos

The four HeyDarlink Instagram accounts (Nina, Fatimah, Teresa, Michaela) post two kinds of frame. Frames with the girl
come from Foxy. Every frame without her (views, food, drinks, interiors, flat lays, city details, sunsets, outfits,
books, flowers) comes from this pipeline. It moved from Quorum (`heydarlink-ambient/`, PR #613) on 8 November 2026,
and on the owner's decision it now runs on demand in batches instead of every day. Nobody approves frames by hand:
automatic gates decide.

## Batches

A batch is one persona's whole shot list (`src/lib/heydarlink/ambient-shots.ts`, ten shots), every shot in 4:5
(1080 × 1350) and 9:16 (1080 × 1920), so 20 frames. A batch starts in one of two ways:

- **By hand:** `POST /api/heydarlink/ambient` as the signed-in owner, optionally with `{ "personas": ["nina"] }`.
  `GET` on the same route lists recent batches with their frame counts and cost.
- **On low stock:** when `HEYDARLINK_AMBIENT_STOCK_URL` is set, the tick asks HeyDarlink for the number of unused
  ready frames per persona (Bearer `HEYDARLINK_INGEST_TOKEN`, response `{ "ready": { "nina": 2, … } }`) and opens a
  batch for a persona below 3, at most once an hour per persona. HeyDarlink has no such endpoint yet, so until it
  exists batches start by hand.

Each persona has at most one open batch. Batches and frames live in `heydarlink_ambient_batches` and
`heydarlink_ambient_frames` (service role only).

## What happens to a frame

Behind `HEYDARLINK_AMBIENT_ENABLED=true`, its own tick (`POST /api/heydarlink/ambient/tick`, pg_cron job
`heydarlink-ambient-tick` every five minutes, two and a half minutes after the marketing tick, signed with
`MARKETING_SCHEDULER_SECRET`) checks the stock and claims frames one at a time for up to 52 seconds, one or two frames
per call, so a batch of 20 takes one to two hours.

1. **Render.** fal `fal-ai/flux/dev` natively at the frame's size. A shot with a `stockSeed` takes a Pexels photo
   of the landmark (portrait, no person in its description) and renders it through `fal-ai/flux/dev/image-to-image`
   at strength 0.8 or more: the geometry stays, the pixels are new. Stock is never posted as it is.
2. **Grade.** One `sharp` pass per persona (tone curve, warmth, saturation, grain, vignette, Lanczos resize, sRGB
   JPEG q92). A source that needs a crop over 20 % is refused.
3. **Gates**, cheapest first; any failure rejects, and a gate that cannot answer counts as a failure:
   - format: JPEG, exact size, at most 8 MB;
   - duplicate: 64-bit DCT perceptual hash within 8 bits of any frame uploaded in the last 90 days;
   - fal's own NSFW flag;
   - Claude (`claude-sonnet-5-5`, `HEYDARLINK_AMBIENT_GATE_MODEL` overrides) rejects any person, face, hand or other
     body part, text, logo, NSFW content, or a frame that does not match its brief. Claude replaces Quorum's OpenAI
     moderation and vision checks.
   A rejected frame gets one more attempt with a new seed.
4. **Upload** to HeyDarlink's `POST /api/photo-library/ambient` (`HEYDARLINK_INGEST_URL`, Bearer
   `HEYDARLINK_INGEST_TOKEN`): the JPEG and its persona, aspect, pillar, shot id, prompt, provider, model, cost, seed,
   pHash and sha256. HeyDarlink checks size, type, sha256 and near duplicates again and stores the frame as ready.

## Money

- **Per batch:** `HEYDARLINK_AMBIENT_BATCH_USD`, default $3 (at most $20). A frame the remaining cap cannot pay for is
  `skipped-cap` and closes the batch as `capped`.
- **Estimate:** fal bills $0.025 per megapixel rounded up, so $0.05 for a 4:5 frame and $0.075 for a 9:16 frame;
  Claude's check is about $0.004 to $0.006 per frame. One batch without retries is about $1.35; with every frame
  retried once it stays under $2.80. Four batches (all personas) are about $5.40, at most about $11.
- Every frame records what it cost (`cost_usd`), renders the provider may have billed included.
- Claude calls need `MARKETING_AI_CONSENT=true`, like every model call in the marketing workflow.

## Switches and keys

| Name | Meaning |
| --- | --- |
| `HEYDARLINK_AMBIENT_ENABLED` | `true` lets the tick work batches; off by default |
| `HEYDARLINK_INGEST_URL`, `HEYDARLINK_INGEST_TOKEN` | upload; without them the step stays idle before anything is paid |
| `FAL_API_KEY` | rendering |
| `ANTHROPIC_API_KEY`, `MARKETING_AI_CONSENT` | the Claude gate |
| `PEXELS_API_KEY` | landmark seeds; without it seeded shots render from text |
| `HEYDARLINK_AMBIENT_BATCH_USD` | the batch cap, default 3 |
| `HEYDARLINK_AMBIENT_STOCK_URL` | optional low-stock check |

## Changing the shot list

Edit `src/lib/heydarlink/ambient-shots.ts`. Every prompt must contain "no people", "no faces", "no text" and "no logos"
in its own words (FLUX dev reads only the positive prompt); shot ids are unique and start with the persona key.
`tests/lib/heydarlink-ambient.test.ts` checks it.
