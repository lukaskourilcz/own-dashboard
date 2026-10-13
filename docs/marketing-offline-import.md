# Offline weekly draft import

This importer saves an already authored devShark weekly bundle for owner review. It makes zero model calls and creates no paid generation job, approval or publication. The source producer must still return an eligible, unexpired packet with the exact authority fields and content hash. A private offline DB export alone cannot pass that live recheck.

The server defaults to disabled. Activation requires `MARKETING_OFFLINE_IMPORT_ENABLED=true`, `VERCEL_ENV=preview`, the exact `MARKETING_OWNER_ID`, and the original active, registered owner pilot window. The database checks the immutable pilot tuple again. This does not add or reset its three paid reservations. The present implementation does not authorize a live import of 42 slots or production activation.

Prepare request files locally with:

```sh
node scripts/marketing-offline-import-requests.mjs --bundle /private/final --packets /private/packets.json --entries /private/owned-calendar-entries.json --output /private/new-requests
```

The entries file contains exactly 42 owner-exported `marketing_calendar_entries` records with `id`, `campaign_id`, `generation_version`, `date`, and `original.slot/sourceId/sourceRevision/contentHash`. The CLI uses exact metadata, verifies artifact hashes and refuses symlinks outside the bundle. It writes private files outside the repository and performs no API calls. Do not commit these files or source copy.

`POST /api/marketing/offline-import` requires the existing owner session and same-origin POST. Each JSON request contains `campaignId`, `entryId`, `entryVersion`, `date`, `role`, `manifestBase64`, `manifestSha256`, `source`, and `files:[{file,base64}]`. Roles are `carousel`, `thread-question`, `thread-answer`, `story-question`, `story-options`, `story-answer`. Supply only that role's manifest descriptors: carousel four JPEG/four SVG files; a Thread one TXT file; a Story one JPEG/one SVG file. The server never executes SVG or dereferences submitted paths or URLs.

Limits: 4 MiB request body, 256 KiB decoded manifest, 2.5 MiB decoded artifacts, maximum 12 files, exact four carousel JPEGs or one Story JPEG. JPEG verification includes full decoding, the declared geometry, one frame, and absent/normal EXIF orientation. Threads retain the exact authored question/options or correct answer/explanation and must fit 500 UTF-8 bytes, Unicode codepoints and UTF-16 units.

The importer binds the owned campaign and calendar version, original source tuple, exact role, Prague schedule and verified account. Paused publisher accounts can receive review drafts. It refreshes the producer before storage and after upload, then the service-only RPC locks the entry and atomically checks the current source head. Immutable private `marketing-assets` objects are verified by downloaded hash and metadata. Seven-day signed links are review previews; they do not make a later weekly slot publishable. A failed import after upload can leave unreferenced private objects; no automatic retry or deletion occurs.

A successful response is `{revisionId,duplicate,ready:false,status:'review',holdCode:'offline-import-review-required',providerCalls:0}`. Repeating an identical slot/version/bundle returns its original identity; a conflicting bundle cannot overwrite it. Existing rows remain held through caption/schedule replacements. The SQL trigger prevents receipt removal and readiness/approval escalation. Campaigns and blocked calendar entries are not activated or rewritten. Stories record a separate `offline-story-svg/1` SVG-derived digest, never the carousel template approval.

Safe error responses contain `{error:code}` only. Invalid JSON/schema/path/file proof returns 400; oversized bodies return 413; a disabled scope returns 403; missing authentication returns 401. Source/entry/account/storage/conflict/save failures return 409. No raw exception, filesystem path, provider message or credential is returned.

## Controlled promotion remains required

Import is complete draft preparation, not final owner approval. A future promotion action must authenticate the owner and revalidate the exact reviewed revision hash, producer source, owned calendar version/account, private asset bytes and schedule. It must bind approved template provenance to the actual format and demonstrate that the authored exercise is preserved in the rendered graphics. Stories need their own approved 1080×1920 layout registry; carousel approval is insufficient. It must explicitly replace the imported hold with a validated readiness receipt before the existing owner approval RPC can queue a publication. Caption edits and manifest `templateApproved` flags cannot perform this transition.

Focused tests execute actual SQL in isolated PGlite and mock provider/storage transports. They cover ownership, immutable pilot gating, slot conflicts, held/expired sources, inherited readiness holds, no publication/job creation, authenticated bounded uploads and local request generation. These offline tests do not prove a live producer, staging migration, storage connection or owner visual approval.
