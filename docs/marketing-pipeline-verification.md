# Offline marketing pipeline verification

> **Historical state, superseded by [#110](https://github.com/lukaskourilcz/own-dashboard/issues/110).** This page describes the October 2026 staging and n8n orchestration, retired on 2026-10-20 ([#113](https://github.com/lukaskourilcz/own-dashboard/issues/113)). The current plan is [`docs/reports/dneskai-instagram-2026-10-20.md`](reports/dneskai-instagram-2026-10-20.md). Retired exports are in [`workflows/marketing/retired/`](../workflows/marketing/retired/README.md); the staging inventory is [`marketing-staging-retired-2026-10.md`](marketing-staging-retired-2026-10.md).

`tests/lib/marketing-pipeline.test.ts` exercises one complete Instagram carousel path locally. It uses the genuine authored devShark question packet from `templates/marketing/benchmarks/devshark-question.json`; the retained producer fixture is unavailable and stays `eligible=false`. An in-memory clone is explicitly labelled **OFFLINE TEST SIMULATION ONLY** and made eligible for this test. This is not evidence that the live producer currently approves that source.

The test runs the actual control-surface and durable-job migrations in PGlite, with minimal `auth.users`, `auth.uid()`, projects, and AI-link prerequisite tables. A bounded adapter replaces only the Supabase RPC transport: `ingestSource` and `saveRevision` call the genuine SQL functions. Approval runs under the authenticated role with the simulated owner's `auth.uid()`. Due claims, container/publish intents, fenced checkpoints, and final receipt transitions use the genuine migration functions. No production database is touched.

`createClaudeMarketingModel` executes the real LangChain adapter against a mocked `ChatAnthropic` SDK. Its structured copy and usage are explicit test responses; retry/strict-output configuration is checked. This proves adapter integration, not live Claude output quality or provider pricing. The returned four slides preserve the actual authored question, exact code, options, answer, and explanation. No model reconstructs those answers.

The renderer uses the genuine Claude Design-derived devShark layout, original checked fonts/marks, and real export archive SHA. Approval is a test-only in-memory manifest bound to the exact template digest and export SHA; the repository template remains `approved=false`. Local native rendering produces four actual 1080×1350 JPEGs. The immutable storage double keeps their bytes, hashes, and provenance metadata under owner-prefixed URLs on `assets.example.invalid`. A separately rendered preview must match every approved asset hash and every stored JPEG byte. Media is never uploaded outside the test.

The acceptance sequence proves:

- Saving a complete content revision yields `ready=true` with its real canonical revision hash.
- An unapproved revision cannot be claimed or sent: a simulated premature publisher request returns `exact-approval-required` and performs zero Meta requests.
- Repeating exact owner approval returns the same publication ID and creates one approval event/publication row.
- A schedule 300 ms in the future becomes due after a 400 ms wait; a freshly reloaded simulated producer packet is persisted before the brand-scoped claim. The wrong brand claims nothing, and the correct claim is exclusive.
- The actual publisher validates mocked profile/quota responses and fetches the exact immutable JPEG bytes before creating four child containers and their carousel container. Durable publish intent precedes the one simulated publish request. (Since approval-04 no intent precedes the container requests; containers are unpublished drafts.)
- The actual publisher revalidates the source before publish and records the mocked media ID/permalink through real fenced receipt SQL. The final revision and publication are `published` with one published event and the original approved revision hash.
- A global fetch guard fails any missed injection, so the test cannot silently call a real provider, storage service, or Meta endpoint. Original eligibility and template approval remain unchanged afterward.

Run the focused proof without starting an app server:

```sh
npx vitest run tests/lib/marketing-pipeline.test.ts --maxWorkers=1
npx eslint tests/lib/marketing-pipeline.test.ts
npx tsc --noEmit
```

The focused pipeline test, scoped lint, and TypeScript checks pass locally. This is an offline integration proof using actual renderer/database logic and explicitly mocked external boundaries. It does not verify live producer freshness, provider availability/quality/cost, LangSmith EU delivery, real Supabase storage or network/RLS behavior, Meta credentials/API-version eligibility, account verification, remote publication, or owner template approval. A separate authorized live pilot must verify those boundaries and review the exact generated assets before activation. The browser workspace acceptance and mutation corpus are documented in `marketing-benchmark.md`; cross-owner, source-withdrawal, and post-edit database cases are covered separately in `tests/lib/marketing-database.test.ts`.
