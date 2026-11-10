# Growth Strategy release evidence — 10 November 2026

Branch: `feat/brand-growth-strategy`. Base: `88ae7e397d908296806bd7cc94a6b0762b424c69`.

## Delivered scope

Both brand workspaces have a bilingual Strategy section, 25 original ideas each, a dated content audit,
experiments, calendar/Lab navigation, proposed-topic/unapproved-concept handoffs and manually recorded native
Insights tied to published receipts. Apify includes a normalized existing sample, actor uses, dated credit
facts, separate brand research briefs and proposed staged spending. It performs no paid execution.
See [research and architecture](../marketing-growth-strategy.md) for evidence and boundaries.

The live owner backlog has two new LinkedIn tasks and two updated existing Facebook tasks. Their IDs and
verification are recorded in the research report. Authenticated writes stayed inside the signed-in Chrome
session; temporary helpers were removed. No account, approval, schedule or social publication changed.

## Validation

| Check | Actual outcome |
| --- | --- |
| `npm run lint` | Passed after Apify UI implementation |
| `npx tsc --noEmit` | Passed on final implementation |
| `npm run test` (full run before Apify UI) | 323 files passed, 1 skipped; 3,076 tests passed, 3 skipped |
| Final focused Vitest: `tests/lib/marketing-strategy*.test.ts`, `tests/components/marketing-strategy.test.tsx`, `tests/components/strategy-results.test.tsx` | 7 files, 23 tests passed; includes new Apify evidence reconciliation and offline/clipboard failure coverage |
| `npm run build` | Passed on final implementation; existing NFT tracing warning and duplicate Sharp Objective-C class warning remain |
| Final Chrome Playwright: Strategy plus project-workspace regression | 6 passed, 2 deliberately skipped; desktop six-width matrix and desktop/mobile handoffs |
| Full Chrome E2E before final Apify addition | 249 passed, 80 skipped, 17 failed; details below |
| `npm run check:render-traces` on macOS | Failed on all 8 image routes because the existing script explicitly requires Linux `libvips-cpp.so`; this macOS build contains `.dylib`. Linux packaging still needs CI verification. No script or native packaging change was made. |
| `git diff --check` | Passed |

The full Chrome E2E failures were one outdated project-tab expectation (fixed and passed in the final targeted
run), two desktop Lab visual baselines, keyword-colour preview request waits, missed-post/waiting-topic favicon
CORS failures from `about:blank`, and publishing-backlog Story-selection expectations. The same latter failure
classes were reproduced on the untouched base checkout. Visual baselines were not regenerated to hide them.
The full suite is therefore **not green**. The final targeted run initially hit an ambiguous text locator
matching both a summary and table caption; it was narrowed to the summary and the run passed.

## Visual and interaction evidence

Google Chrome, not T3 browser or bundled Chromium, ran the local fixture-only `/dev-preview` checks.
The final Strategy matrix exercised 360, 430, 768, 1024, 1440 and 1728 px, including the expanded Apify cohort
table, with no document overflow. Czech/dark and English/light views passed axe with no violations.
Keyboard Enter opens idea details. Both brand handoffs reach the canonical preview Lab/topic store without
server requests or approval. Missing audience metrics stay empty; offline research remains readable and
writes are disabled. Clipboard denial exposes a selectable research brief and a localized status message.

Inspected local evidence: `test-results/strategy-apify-cs-dark.png`; the run also captured
`test-results/strategy-cs-dark.png`. These contain deterministic fixture data, not production owner records.
No generated media was produced. Existing source rights, photo order, rendering and approval contracts remain.

Local logs, outside source control:

- `/tmp/devshark-strategy-lint.log`
- `/tmp/devshark-strategy-tsc-final.log`
- `/tmp/devshark-strategy-final-vitest.log`
- `/tmp/devshark-strategy-vitest-release.log`
- `/tmp/devshark-strategy-build-final.log`
- `/tmp/devshark-strategy-e2e-final.log`
- `/tmp/devshark-strategy-e2e-full.log`
- `/tmp/devshark-strategy-baseline-e2e.log`
- `/tmp/devshark-strategy-baseline-rest.log`
- `/tmp/devshark-strategy-render-traces.log`

## Rollout still required

The working branch is pushed with GitHub-attributed author identity. Production migration and deployment
have not occurred. This checkout has no linked Supabase project or database connection. Apply only the
reviewed `20261110210000_marketing_strategy.sql` through the established migration process, verify owner and
stranger access plus an idempotent unapproved handoff, then deploy the application. Review the existing
full-suite failures before release. Do not run a blanket migration push over unrelated pending migrations.
No paid Apify run, provider budget, runner reservation or pipeline switch has been changed.
