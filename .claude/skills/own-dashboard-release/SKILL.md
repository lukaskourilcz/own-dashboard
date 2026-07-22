---
name: own-dashboard-release
description: Validate and hand off an OwnDashboard release or large implementation. Use before committing or reporting completion when changes can affect product behavior, design, Supabase/RLS, invoices, AI consent, PWA, integrations, responsive UI, documentation, migrations, or generated media.
---

# OwnDashboard release

1. Inspect `git branch --show-current`, `git status --short`, unstaged/staged diffs, and recent commits. Preserve unrelated work; stage exact paths/hunks; never commit secrets, caches, `.env`, or unavailable-media outputs.
2. Review the diff against `AGENTS.md`, `CLAUDE.md`, `DOCS.md`, design docs, migration docs, and the applicable product/design/media skills. Search for old branding, Takt, restored personal scope, Tugedr/Pulse confusion, raw enums, arbitrary colors/radii, duplicate statuses, dead assets, fake UI, and broken links.
3. Validate Supabase ownership/RLS, service-role boundaries, route-scoped loading, query invalidation, static FX, project scoping, AI consent/sources/writes, exports, migration ordering, and unknown/cross-user 404 behavior.
4. Validate Czech invoices separately: calculations, VAT, rounding, dates/symbols, QR Platba, import review, A4 print isolation, and dark-mode independence.
5. Run exact commands: `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`, and `npm run test:e2e`. Run targeted checks during repair. Never call a hanging/interrupted/unrun command successful.
6. Run `/dev-preview` visual/accessibility checks from the visual-QA skill, verify PWA metadata/icons/install affordance, and inspect media sizes/usage/fallbacks. Higgsfield work stays deferred when its MCP is unavailable.
7. Use `git diff --check`; create coherent imperative commits only after relevant evidence. Do not push unless explicitly requested.
8. Finish with exact command results, critical flows covered, commit hashes/scopes, working-tree state, unrelated pre-existing files, push status, and only concrete unresolved limitations.
