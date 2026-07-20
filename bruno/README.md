# API auth-regression tests (Bruno)

A tiny [Bruno](https://usebruno.com) collection that guards the app's API
routes against auth regressions. Each request hits a protected route with **no
session** and asserts the **handler's own** auth gate rejects it — so if a
future change weakens that gate, these go red.

API routes are exempt from the page-level session redirect (that redirect used
to 307 cookieless requests to `/login`, which silently bounced the Vercel Cron
jobs before their handlers ran). So each route now self-authenticates, and
these tests assert that directly:

| Request | Route | Expected |
| --- | --- | --- |
| GitHub repos require auth | `GET /api/github/repos` | `401` (getUser) |
| GitHub file read requires auth | `GET /api/github/file` | `401` (getUser) |
| Quick-add requires auth | `POST /api/quick-add` | `401` (same-origin, then getUser) |
| Cron endpoint requires auth | `GET /api/cron/renewal-warnings` | `403` (bad bearer, needs `CRON_SECRET` set) |

Notes:
- Quick-add sends a same-origin `Origin` header so it clears the CSRF gate
  (`rejectCrossOrigin`) and reaches the `401`; drop it and it's a `403`
  "Missing Origin header." instead.
- The cron test asserts the `Bearer ${CRON_SECRET}` mismatch → `403`, which
  only applies when the running app has `CRON_SECRET` set. With it unset the
  route has no secret to check and this test doesn't apply.

## Run

Point the `Local` environment at your instance (defaults to
`http://localhost:3000`), or add an env under `environments/` for preview/prod.

```sh
# GUI: open this folder in the Bruno app.

# CLI (run from this folder):
npx @usebruno/cli run . --env Local
```

Credential-free — they only ever assert rejection, so they're safe to run in CI
against a running instance.
