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

## Production rollout — owner authorization on 10 November 2026

The owner explicitly authorized deployment. The signed-in Supabase dashboard was reached through Chrome
using its existing GitHub login. Supabase MCP tools were not exposed to this agent session. The native
management query endpoint was used inside the browser; session credentials were never exported.

Preflight confirmed both Strategy tables and the migration-history entry were absent, and the required
canonical tables, private schema, tab constraint and two brand projects existed. Only the exact reviewed
`20261110210000_marketing_strategy.sql` was applied, together with its history entry in one transaction,
with a five-second lock timeout and 30-second statement timeout. Migration SHA-256:
`ff0b4a3af5117d1966889a2df4ce563d8798de45145ea03487f7631df4cb52ea`.

A production rollback-only smoke transaction verified the owner's draft/topic handoffs, duplicate-call
idempotency, draft/proposed state and stranger read/write denial. The returned check confirmed both new
tables have RLS and zero smoke links were retained. No unrelated pending migration was applied.

PR #321 merged at 21:37:38 UTC as `dcc427b536e87614385569986f45d47362a3d8dc`, preserving the individual
GitHub-attributed commits. Vercel completed production deployment `C3utpgXZ3UvnUvqri2hq8fdDw2Wh` at 21:39:20 UTC
(GitHub deployment `7695016918`). The Vercel dashboard reported Ready / Production / Current and the
production domain `https://own-dashboard-tau.vercel.app` served the new Strategy. The known broader E2E limitations above remain explicit; a green
Vercel build does not establish a green full test suite.

No paid Apify run, provider budget, runner reservation, schedule or pipeline switch changed.

### Live production verification

Both brand Strategy workspaces rendered through the signed-in Chrome session without alert banners.
The DNESKAi Apify panel showed its research brief, and devShark exposed all 25 idea details. Authenticated
Strategy API reads returned HTTP 200 for both projects: 5 loaded devShark and 33 loaded DNESKAi publication
receipts, with zero Strategy links and zero manual results. These are bounded operational reads, not audience
metrics or total post counts. The shared publishing calendar returned HTTP 200 with 21 loaded posts;
an unauthenticated Strategy read returned HTTP 401. No live idea was approved or published during verification.
