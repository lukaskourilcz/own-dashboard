# Marketing renderer diagnostic

The existing authenticated `POST /api/marketing/n8n` accepts this diagnostic operation:

```json
{
  "operation": "render-preflight",
  "brand": "devshark",
  "sourceId": "EXISTING_PRODUCER_SOURCE_ID",
  "scheduledAt": "FUTURE_ISO_TIMESTAMP"
}
```

The server requires `VERCEL_ENV=preview`, the active fixed owner-bound pilot, marketing AI consent, an existing verified owned Instagram account, and the current trusted Claude Design template approval. The schedule must be in the next six days. The request cannot supply a source packet, template, account, owner or approval. A paused publishing account can still support this diagnostic.

The server loads the owned source head and refreshes it from the producer. It uses only an eligible, unexpired question or coding task with a verified canonical content hash. It renders the exact authored question, options, answer, explanation and code, or the deterministic public coding challenge. An in-memory revision labels its caption “Renderer diagnostic only.” The server rechecks the producer, pilot and template before returning success. Article layout diagnostics are currently unsupported.

The response contains `diagnosticOnly:true`, `providerCalls:0`, `storage:"not-exercised"`, an asset count, JPEG/SVG SHA-256 hashes, dimensions and byte counts. It contains no source copy, caption, JPEG bytes, private URLs, account identifiers or credentials. The operation makes no model or trace call, job reservation, database write, storage upload, revision save, approval or publication. A successful response verifies rendering in that runtime; it does not verify Storage or grant publication readiness.

The renderer classifies missing brand/font/design files, native module imports, rasterization, JPEG encoding, geometry and layout failures using fixed codes. It discards exception messages, causes and filesystem paths. Template digests, fonts, layout, fact checks and approval requirements stay unchanged.

For future Instagram question/challenge jobs, the worker exercises this authored renderer after its authoritative source/template checks and before its first model invocation. The check uses memory only. It does not reset pilot reservations or permit a failed job to retry.

Generation trace status `review` describes successful copy validation. The durable job and saved ready revision determine whether the complete preparation succeeded. If later preparation fails, the worker attempts an exact-revision-bound root trace update with a fixed failure code while preserving the measured copy usage and hashes. This diagnostic update is best effort: indexing delay or a tracing outage can prevent it, and the worker performs no diagnostic network retry. The durable job remains the authority for failure.

Local tests exercise real JPEG rendering from retained authored fixtures under explicitly labelled eligibility/approval simulations, missing files/native modules, API authentication and field rejection, producer withdrawal, pre-paid holds and trace privacy. Retained fixtures and public template manifests remain unapproved/ineligible. These tests do not prove a deployed Linux renderer, Storage upload or a live provider result.

## Native JPEG packaging

The first deployed zero-model diagnostic returned `render-jpeg-encoder-unavailable`. The local Next.js 16.2 output trace included Sharp's native addon but omitted its installed libvips dynamic library. An isolated package containing only the traced public dependencies failed to load Sharp; adding that one library made the same package load. Both Sharp 0.35.5 official ESM and CommonJS exports are callable locally. This demonstrates a local packaging defect; the deployed failure still needs verification after the fix.

The two existing marketing render route rules now include `./node_modules/@img/sharp-libvips-*/lib/**/*`. The pattern includes installed runtime libraries across platforms without selecting an architecture or installing a new dependency. Next.js already externalizes Sharp, so the fix keeps its loader, dependency version and template digests unchanged. The regression test builds an isolated public package without the library, confirms failure, adds the configured library directory and encodes a real JPEG through the official ESM export. It passes no inherited credentials or instrumentation hooks to the child process.

The local Next.js output-tracing guide permits narrow route-scoped runtime asset includes. Sharp documents deployment binary requirements and externalization in its [installation guidance](https://sharp.pixelplumbing.com/install/). The existing Preview diagnostic must verify the rebuilt deployed renderer with zero provider calls before any additional generation authorization.
