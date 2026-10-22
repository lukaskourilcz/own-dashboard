# Browser agent prompt: connect @dneskai and add the production key

Written on 22 October 2026 for a browser agent working in Lukáš's own Chrome. Production runs `own-dashboard` main `ecb9716` or newer. The owner's full list is in [owner-todo.md](owner-todo.md). Section 1 there is what this prompt covers, plus the n8n archiving from section 7.

Checked before writing (names only, no values): Vercel Production already has `MARKETING_OWNER_ID` and `MARKETING_APPROVED_ASSET_HOSTS`. It lacks `ANTHROPIC_API_KEY` (only a Preview copy exists, for branch `codex/marketing-automation`) and all six `MARKETING_DNESKAI_INSTAGRAM_*` values. Supabase has the token table and 0 `marketing_accounts` rows.

---

```text
You are operating Lukáš's own Google Chrome, where he is already logged in. Finish the setup that lets OwnDashboard's DNESKAi pipeline draft Instagram posts for @dneskai (https://www.instagram.com/dneskai). Work slowly and check each screen before you click.

HARD RULES
- Secrets (Instagram tokens, API keys, app secrets) go only into the Vercel input field where they belong. Never type them into chat, a report, a note, a screenshot description, a GitHub issue or any other page. In your report, write "set" instead of a value.
- Do not publish anything to Instagram. Do not turn on MARKETING_PUBLISH_ENABLED, MARKETING_DNESKAI_PUBLISH_ENABLED or the account's publishing switch.
- Do not buy anything, change a plan, create a new account (Meta, Instagram, Anthropic, n8n, Apify, LangSmith) or enter payment details.
- Do not delete anything. Archiving and renaming are allowed only where this prompt says so.
- Do not run SQL in Supabase, and do not change any other Vercel variable.
- If a login, 2FA code, CAPTCHA, phone confirmation or a choice not covered here appears, stop and ask Lukáš. Never guess.

TASK 1: Anthropic key for production (5 min)
1. At console.anthropic.com → API keys, create a key named own-dashboard-dneskai-production, with no expiry or the longest offered.
2. At vercel.com → team lukas-kourils-projects → project own-dashboard → Settings → Environment Variables, add ANTHROPIC_API_KEY with that key. Target: Production only. Mark it Sensitive.
3. Leave the existing Preview-only ANTHROPIC_API_KEY of branch codex/marketing-automation as it is.

TASK 2: Make @dneskai a professional account (5 min, needs Lukáš's phone)
1. If Instagram on the web offers it, switch @dneskai to a Business or Creator account (Settings → Account type and tools). If it can only be done in the mobile app, stop and ask Lukáš to do it.
2. Confirm the profile now shows a professional category.

TASK 3: Meta app with Instagram Login (20 min)
1. Open developers.facebook.com → My Apps. If a Business-type app with the Instagram use case already exists for OwnDashboard/DNESKAi, use it. Otherwise create one: type Business, use case "Instagram" → "API setup with Instagram login". Keep the app in Development mode, and never submit it for App Review.
2. Under App roles → Roles, add the Instagram account dneskai as an Instagram Tester. Then ask Lukáš to accept the invitation in the Instagram app (Settings → Website permissions / Apps and websites → Tester invites) and wait for his confirmation.
3. In the Instagram API setup, request exactly these two permissions and nothing else: instagram_business_basic and instagram_business_content_publish.
4. Generate the access token for dneskai in "Generate access tokens". It must be the long-lived token, valid for 60 days. Note the Graph API version the app dashboard shows, for example v26.0.
5. Open the token in Meta's Access Token Debugger (developers.facebook.com/tools/debug/accesstoken). Note its expiry date and the granted scopes. If the scopes are not exactly the two above, stop and ask.

TASK 4: Instagram settings in Vercel (10 min)
In the same project, add these for Production only and mark each Sensitive:
- MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN = the token from task 3.4
- MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE = instagram
- MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES = instagram_business_basic,instagram_business_content_publish (only if the debugger showed exactly these)
- MARKETING_DNESKAI_INSTAGRAM_API_VERSION = the version from task 3.4, for example v26.0
- MARKETING_DNESKAI_INSTAGRAM_API_VERSION_VERIFIED_AT = the current time in ISO format, for example 2026-10-22T14:30:00Z
- MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT = the debugger's expiry in ISO format, for example 2026-12-21T14:30:00Z
Do not add MARKETING_DNESKAI_INSTAGRAM_HANDLE, because the default is dneskai. MARKETING_OWNER_ID and MARKETING_APPROVED_ASSET_HOSTS already exist; leave them.

TASK 5: Redeploy and verify (5 min)
1. In Vercel → own-dashboard → Deployments, redeploy the latest Production deployment and wait for READY.
2. Open https://own-dashboard-tau.vercel.app (Lukáš is logged in), go to the DNESKAi project → tab Zdroje (Sources) → panel Instagram account, and press "Ověřit účet" (Verify account) once.
3. Expected: Verified, publishing disabled, the token's expiry date shown. If you see an error code instead, for example professional-account-required, copy only the code and stop. Verification allows 5 attempts per 10 minutes, so do not retry more than twice.

TASK 6: Archive old n8n workflows (5 min)
At the n8n Cloud workspace, archive these three workflows: 1hB4ROPAlWm3YSXn (DNESKAi pilot worker), MK0xn98gIXofmZSn (DNESKAi production verification) and JyX8hAYI8sKMDPIc (DNESKAi rotating sources). Archive only; do not delete. Rename the three DNESKAi staging credentials by adding the prefix "RETIRED ". If you can't tell which credentials those are, stop and ask. Do not touch devShark or knowledge workflows.

NOT YOUR JOB (Lukáš decides these): Apify switches, LangSmith, the pilot post, publishing switches, deleting variables or credentials, anything in Supabase, any of the 21 decisions in docs/reports/dneskai-audit-2026-10/owner-todo.md.

REPORT AT THE END
A short list: each task done / stopped (with the reason and any error code) / skipped. List the variable names you set, never their values. Include the token expiry date and the API version you used.
```
