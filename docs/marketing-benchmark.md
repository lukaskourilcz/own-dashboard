# Marketing offline acceptance

`scripts/marketing-benchmark.ts` evaluates 45 local acceptance cases against the retained, authored packets in `templates/marketing/benchmarks/`: a Czech DNESKAi article, an English devShark question, and an English devShark coding task. The fixture manifest describes their holds. All three original packets remain `eligible=false`; this suite never makes them production eligible, persists them, uploads media, or publishes posts. The coding task also lacks a safe authored explanation and remains held for that reason.

The dataset includes three held baselines and deliberate mutations for mismatched content hashes, unsupported source schemas, private fields, wrong brand/locale, expired eligibility, withdrawn source revisions, malformed copy JSON, copy schema violations, unsupported numbers, missing/out-of-range citations, model-written code, an altered authored answer, and oversized copy/source code. Font/layout probes exercise Czech diacritics, exact decomposed code identifiers, long code lines, code/prose height, unbreakable words, unsupported glyphs, and template digest changes. Counterfactual eligibility and all mutations/layout probes are explicitly marked `offlineSimulation` in the report and exist only in memory.

The wrong-answer case compares a mutated packet with its immutable authored fixture. This proves benchmark provenance rejection; it is not a generic semantic judge. Citation index and numeric checks do not prove complete factual entailment. Malformed source inputs are caught per example as `invalid-source` so one rejection cannot abort the entire dataset.

Run from the repository root:

```sh
npx vitest run tests/lib/marketing-benchmark.test.ts --maxWorkers=1
npx esbuild scripts/marketing-benchmark.ts --bundle --platform=node --packages=external --format=cjs --outfile=node_modules/.cache/marketing-benchmark.cjs
NODE_ENV=test node node_modules/.cache/marketing-benchmark.cjs --output=/tmp/marketing-offline-benchmark.json
```

The compilation uses the existing local esbuild dependency and writes to ignored `node_modules/.cache`. `NODE_ENV=test` enables the local preview renderer for pending templates. Production template approval gates remain unchanged. The script exits unsuccessfully for unexpected issue codes or a changed repeat-render hash. Its report contains issue codes, original content hashes, local timing, and JPEG metadata; it excludes raw source text, owner notes, credentials, and provider payloads.

The recorded local run on 2026-10-13 passed **45/45** cases and rendered six 1080×1350 JPEG slides with identical hashes on a second render. These timings describe this machine/run, not production throughput:

| Held source | Slides | First render | Repeat render | Repeat hashes |
| --- | ---: | ---: | ---: | --- |
| DNESKAi article | 2 | 118.91 ms | 88.79 ms | identical |
| devShark question | 4 | 158.20 ms | 154.28 ms | identical |

**Provider calls: 0.** Provider cost is `null`, with status `not-measured-no-provider-calls`. No Claude generation quality, actual provider price/cost, production eligibility, remote storage, tracing delivery, or live publishing performance has been measured by this suite. Local rendering uses the genuine Claude Design-derived templates while their owner approval remains pending; rendered packets remain held QA material.

`e2e/marketing-workspace.spec.ts` covers the authentic empty `/dev-preview?tab=marketing` surface in EN and CS, desktop and 360-pixel mobile. It checks the empty review queue, disabled refresh/calendar/knowledge forms, absent fabricated approval cards, no marketing write requests, Arrow/Home/End tab navigation, no horizontal overflow, and axe accessibility scans on all four tabs. Separate real HTTP requests assert unauthenticated state/approval/knowledge/jobs requests and an invalid n8n token return 401 before any operation runs. Browser requests are not replaced with fabricated marketing responses.

```sh
npx playwright test e2e/marketing-workspace.spec.ts --list
npx playwright test e2e/marketing-workspace.spec.ts
```

Test collection currently yields eight cases across the configured desktop/mobile projects. Collection and the offline suite were verified independently; the parent integration run owns the actual browser execution and app build to avoid competing servers.

The empty preview cannot honestly cover a populated approval dialog, stale revision action, or authenticated backend error. If those UI paths need isolated browser coverage, add a test-only opt-in state prop at the panel boundary under the existing E2E harness: use an exact retained authored packet and local readonly JPEG fixture, `ready=false`, no verified publishing account, and disabled approval/publishing actions. Keep that harness out of ordinary `/dev-preview`; no dummy cards or publishable fixture records should be introduced. Real approval acceptance still requires producer-fresh eligible sources, exact owner-approved template digests, configured server credentials and AI consent, and a separately authorized live model pilot.
