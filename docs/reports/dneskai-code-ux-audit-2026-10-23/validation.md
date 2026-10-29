# Validation record

23 October 2026. Source baseline `d6f60c7271c8078713fe2f56d63bc71fe10a5692`; isolated audit branch. Application source, schema, environment variables in Vercel and Production behavior remain unchanged.

## Executed checks

- Focused DNESKAi suite: `npx vitest run --maxWorkers=4 tests/lib/dneskai*.test.ts tests/lib/marketing-dneskai*.test.ts tests/components/*dneskai*.test.tsx tests/audit/dneskai-review-baseline.test.tsx`. **108 files, 1087 tests passed**, 62.86 seconds. Includes unit, component and local database-contract tests; no live database migration or provider call. Four tests intentionally assert baseline defects C02–C05. The four probes were rerun after making their synthetic row chronology explicit; all passed.
- `npx tsc --noEmit`: **passed**, exit 0.
- `npm run lint`: **passed**, exit 0. Final artifact/probe lint also passed with exit 0.
- `node --check` on plan.js and plan-data.js: syntax checked. Local references, data IDs, component source paths, evidence files and report anchors checked by `verify-artifact.mjs`.
- Source scan: 155 component files, 137 marketing libraries, 37 marketing routes and 49 related migrations. All paths appear in inventory.json. Component family/recommendation mapping appears in component-coverage.json.

## Browser work

Used the owner's Google Chrome extension through Cua. All application captures use the genuine dev-preview shell with synthetic fixtures and placeholder local configuration; no Production or private account data appears in the audit captures.

- Inspected all 27 canonical application destinations and ten shared project workspace tabs. DNESKAi also includes Lab, selected editor, Calendar, Posts, Sources, Daily mix, audio library and account/cost dialogs. Login was viewed without signing in. An unauthenticated unknown route redirected to Login; it is labelled as that redirect, not a verified not-found screen.
- Captured 74 application states with DOM snapshots and geometry files. The manifest records language, theme and viewport. The visual plan's own proof captures live separately in proof/.
- Width samples: DNESKAi 360/430/768/1024/1440/1728; additional main destinations at 360 and 1440. EN/light and CS/dark across selected views, with additional CS/light samples. No claim of a full cross-product matrix.
- Reproduced unsaved headline loss by leaving and returning to the Lab, using fixture edits only. Opened Sources/mix/music, project tabs, command palette and mobile More. Exercised Career's fixture-only Check for new offers. No content was published by these tests.
- Mobile More backward Tab wrapped to Close; Escape dismissed it but focus returned to BODY. Command palette Escape also returned focus to BODY. The report recommends opener restoration rather than claiming full keyboard compliance.
- Plan interactions: switched visual treatments, toggled proposed width, opened/enlarged a screenshot, dismissed it with Escape and verified opener focus returned. Component search for DNESKAi returned 39 matching records; an unmatched destination search returned a clear zero-result state. All eight visual treatments had no broken images or document overflow at 1440 px; the evidence gallery returned 74 captures and its 430 px filter returned two. At 360 px the plan's document width matched the viewport. The generated code-review reading page was also opened and checked in Chrome.

The initial local preview on 127.0.0.1 showed fit endpoint 403 responses and dev-only indicator overlays. A subsequent localhost preview with NEXT_E2E enabled showed settled fit feedback and the real fixture headline render. These local setup responses are not treated as Production defects. Some early captures include the PWA prompt or a chart mid-animation. The current UI images stay authentic; the HTML labels proposed structures separately. The example slide in the Lab proposal is a Chrome screenshot crop of the current fixture render.

## Limits and implementation acceptance

- No live EXPLAIN/ANALYZE, Production trace, network byte benchmark or external provider spend. Query/index and thumbnail recommendations remain measurement proposals.
- No full automated axe, screen-reader, reduced-motion, zoom/reflow or A4 print pass. No broad claim of WCAG conformance. Manual DOM geometry and label/ID probes establish the specific issues reported.
- Browser inspection observed fixture empty, disabled, pending, failed and disconnected states. Every permission, reauthorization, offline, slow-loading and destructive dialog combination was not forced in Chrome.
- Notes/Settings produced dnd-kit described-by hydration mismatch logs, and charts produced initial dimension warnings. Reproduce in a clean browser and a production build before assigning Production severity. No warning was hidden through a product-code edit.
- Existing owner checkpoints from the publishing handoff remain in NEEDED.md. The audit neither resolves those account decisions nor changes the live Reel or publisher state.

Before implementing or releasing the proposed layouts, run the five batches in ux-audit.md with before/after screenshots, complete keyboard/axe checks, both languages/themes, all six widths and the invoice regression suite. Preserve own-only RLS, consent/evidence boundaries, static FX, Czech invoice correctness and exact saved-revision approval.
