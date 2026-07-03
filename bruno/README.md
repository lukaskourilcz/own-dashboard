# API auth-regression tests (Bruno)

A tiny [Bruno](https://usebruno.com) collection that guards the app's API
routes against auth regressions. Each request hits a protected route with **no
session** and asserts the auth middleware bounces it to `/login` with a `307`
before the handler runs — so if a future change weakens that gate, these go red.

| Request | Route | Expected |
| --- | --- | --- |
| GitHub repos require auth | `GET /api/github/repos` | `307` → `/login` |
| GitHub file read requires auth | `GET /api/github/file` | `307` → `/login` |
| Quick-add requires auth | `POST /api/quick-add` | `307` → `/login` |
| Cron endpoint requires auth | `GET /api/cron/renewal-warnings` | `307` → `/login` |

Redirect-following is disabled per request (`settings { followRedirects: false }`)
so the `307` is observable instead of the login page it lands on.

Defense-in-depth still lives in the handlers (a same-origin CSRF check + a `401`
in quick-add; a `401` in the GitHub routes; a `Bearer ${CRON_SECRET}` → `403`
check in cron). Those apply once a request gets past the middleware (i.e. with a
session cookie); this collection covers the front-line unauthenticated gate.

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
