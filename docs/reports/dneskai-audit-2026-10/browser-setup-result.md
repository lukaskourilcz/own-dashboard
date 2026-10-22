# DNESKAi browser setup and continuation — 22 October 2026

## Current result

The six browser setup tasks are complete. The later request to enable publishing is **complete**: both Production switches are true and @dneskai shows Publishing enabled. No post was approved or published, and no live pilot was run.

| Task | Verified result |
|---|---|
| Anthropic | Production `ANTHROPIC_API_KEY`: set, Sensitive/Secret. Key created without expiry. Preview unchanged. No generation test performed. |
| Instagram | `@dneskai` is a professional Creator account. |
| Meta | OwnDashboard DNESKAi, app ID `1136531738840825`; Instagram app ID `1133726409172801`. Development/unpublished, no Business Portfolio. Tester invitation accepted. |
| Production Instagram configuration | All six `MARKETING_DNESKAI_INSTAGRAM_*` setup variables: set. API version v26.0; verified 2026-10-22T14:14:36.221Z. Token valid in Meta debugger, expires **2026-12-21T14:07:44Z** (15:07:44 Prague). |
| Deployment and verification | [Production deployment J9KLE4FbdkdZGgZmxxmvu3a6izHf](https://vercel.com/lukas-kourils-projects/own-dashboard/J9KLE4FbdkdZGgZmxxmvu3a6izHf), source `ae9e92ed806ea2e438c65fb3374eabff3fd7379a`, Ready 22 October 16:16:27 Prague. Sources → Verify account succeeded once at 16:17 Prague: Verified, @dneskai, valid token, Publishing disabled. |
| n8n retirement | Three workflows archived and three credentials renamed RETIRED. Nothing deleted. |

## Owner-approved scope exception

The owner explicitly chose to retain all five scopes granted by Meta's token flow:
`instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_content_publish`, `instagram_business_manage_insights`, `instagram_business_manage_comments`.
Production metadata records the actual five; do not silently replace it with the original two-scope plan or revoke permissions. The owner also approved inspection in Meta's official token debugger. No secret values belong in this report, issues, logs or commits.

## n8n evidence

Archived in the owner's Chrome:
- `1hB4ROPAlWm3YSXn` — isolated DNESKAi pilot worker.
- `MK0xn98gIXofmZSn` — DNESKAi production verification.
- `JyX8hAYI8sKMDPIc` — DNESKAi rotating sources at 22:00.

Saved credential names:
- `RETIRED OwnDashboard DNESKAi single production run 20261013`
- `RETIRED OwnDashboard DNESKAi collection pilot — expires 2026-10-15 09:10 UTC`
- `RETIRED OwnDashboard marketing staging — expires 2026-10-15 09:10 UTC`

devShark, knowledge processing and weekly review were untouched. Preview variables, branches, deployments, credentials and retained ledgers were not deleted.

## Publishing enabled — 22 October 2026

The owner completed Vercel email verification and saved Production `MARKETING_PUBLISH_ENABLED=true`. The agent verified it, added Production `MARKETING_DNESKAI_PUBLISH_ENABLED=true`, and redeployed the current main source.

[Deployment 61NBJAaMqE9bmfTYHZwHZeeDUsUS](https://vercel.com/lukas-kourils-projects/own-dashboard/61NBJAaMqE9bmfTYHZwHZeeDUsUS) is **Ready / Production / Current**, with the same source commit `ae9e92ed806ea2e438c65fb3374eabff3fd7379a`; Vercel shows 22 October 16:33:53 CEST. Sources was refreshed after deployment and @dneskai was enabled through its confirmation dialog. The resulting UI shows **Ověřeno / Publikování zapnuto / Token je platný** and the stop-publishing button.

No final post was approved or published. The 17:00 and 20:00 topics were not approved at the activation check. Publishing activation is not proof of generation, rendering, costs or a receipt. Preview configuration and devShark settings were untouched.

Continue with #123: exact owner-reviewed asset/text/account/time, budget ≤ $1.50, real receipt and read-only reconciliation. Switch publishing off after the pilot unless the owner authorizes daily operation. Stop for login, 2FA, CAPTCHA, phone verification or uncovered choices. No purchases, new accounts or deletion; secrets only in Vercel fields.

## Remaining development work

- #110 stays open: complete the live chain; setup verification is not generation/render/publication proof.
- #113 stays open for the recorded branch/tag and post-pilot owner cleanup; archive/rename work is done.
- #121 remains closed; account connection is now verified in production. Token refresh and publisher dry-run were not exercised in this browser session.
- #122 remains open: EU LangSmith setup and later evaluation; no configuration performed here.
- #123 remains open: exact owner review, pilot, cost evidence and receipt.
- Migration-history reconciliation and prepared migrations remain pending. Do not run a blind database push.
- Preserve owner decisions in `owner-todo.md`, follow-up feed checks on 23/25/28 October, and the staging cost ledger.

## Claude handoff

Read this report, AGENTS.md, CLAUDE.md, NEEDED.md, docs/external-setup.md §11 and current #110/#113/#121/#122/#123 before working. Inspect current main, open PRs and the dirty local workspace; this report's production commit is a deployment snapshot, not a claim about the latest development head. Do not recreate keys, app or tester setup. Use an isolated branch/worktree and preserve unrelated local work. Read the installed Next.js guides before code changes. Make small coherent changes, run relevant project checks, and update evidence and remaining blockers. Publishing is already enabled; do not rerun setup. Verify live state before testing.
