# /release-validate

1. Read the release skill; inspect branch, status, staged/unstaged diffs, untracked files, and recent commits.
2. Audit scope, secrets, docs links, migrations, RLS-sensitive flows, static FX, invoices/print, AI consent/evidence, PWA, deferred media, removed scope, and Tugedr terminology.
3. Run `npm run lint`.
4. Run `npx tsc --noEmit`.
5. Run `npm run test`.
6. Run `npm run build`.
7. Run `npm run test:e2e` and the visual/axe workflow for affected routes.
8. Fix feasible failures and rerun affected gates; use `git diff --check`.
9. Verify intended files are committed, unrelated changes remain untouched, temporary files are absent, and no push occurred unless explicitly requested.
10. Report exact results, critical flows, commit hashes/scopes, working-tree state, and only concrete limitations.
