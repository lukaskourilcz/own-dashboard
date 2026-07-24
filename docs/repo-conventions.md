# Repository markdown conventions

The canonical format for the per-repo markdown files OwnDashboard reads and
renders. Every linked repo should follow this exactly so the files are
identical in shape, easy to parse, and render cleanly in the dashboard. The
per-repo `session-start`, `session-end`, and `markdown-checkup` skills all
write to this spec.

## `NEEDED.md` — owner/agent action items

A markdown checklist at the repo root. One task per list item. OwnDashboard's
Tasks section imports these (see `src/lib/needed.ts`).

```
- [ ] **Short title** — one-line description. `[imp:4]` `[owner:me]` `[time:30m]` `[kind:setup]`
```

Rules:

- **Checkbox**: `- [ ]` open, `- [x]` done (done items are ignored on import).
- **Markers** (order-free, optionally wrapped in backticks; stripped from the
  visible title). A marker may sit on an indented continuation line of the task.

  | Marker | Meaning | Values |
  |---|---|---|
  | `[imp:N]` | Importance / priority | `1`–`5` (5 = highest) |
  | `[owner:X]` | Who does it | `me` (owner) or `ai` (an agent can) |
  | `[time:T]` | Estimated effort | `30m`, `2h`, `1h30m`, or a bare number (minutes) |
  | `[kind:K]` | Work kind | `setup`, `deploy`, `legal`, `content`, `decision` |

- **`[kind:…]` vocabulary** (pick the closest one):
  - `setup` — secrets, env vars, API keys, and third-party service wiring.
  - `deploy` — deployment, DB migrations, and production verification/smoke tests.
  - `legal` — privacy texts, terms, licensing, compliance.
  - `content` — real copy, photos, logos, testimonials, icons/OG art.
  - `decision` — an owner choice or approval (name, budget, provider, scope).

- Use `[owner:ai]` for anything an agentic session can do end-to-end; `[owner:me]`
  for anything needing the human (credentials, approvals, physical checks).
  Do **not** use `[owner:agent]` — it's `[owner:ai]`.

## `about-project.md` — what the project is + its stack

Repo root. An opening one-paragraph summary, then:

- `## Tech stack` — a bullet list, each `Name — what it does`.
- `## Third-party libraries` (or connected services) — same `Name — what it does`.

This is the **only** place the technology stack is documented.

## `scaling.md` — cost and scaling (renamed from `stack-and-scaling.md`)

Repo root. Cost/scaling **only** — the stack lives in `about-project.md`, so do
not repeat it here. Include: a current-cost table (fixed vs variable vs
excluded), realistic growth bands with assumptions, measured upgrade triggers,
and cost controls. Distinguish official prices from calculated scenarios and
note the date prices were checked. OwnDashboard reads `scaling.md` and falls
back to the legacy `stack-and-scaling.md` during the rename.

## `monetization.md` — how the project could earn

Repo root. A short framing sentence, then a table of options chosen for **this**
project (e.g. GitHub Sponsors, ads, subscriptions, one-off sales, a
buy-me-a-coffee banner, consulting, a paid template — decide per project), then
a one-line recommendation.

```
| Option | Likelihood of income | Possible earnings | Pros | Cons |
|---|---|---|---|---|
| … | Low / Medium / High | rough monthly range | … | … |
```

Keep it honest: mark options that don't realistically apply, and don't present
speculative numbers as facts.

## Per-repo skills

Each repo carries these under `.claude/skills/<name>/SKILL.md`, all written to
this spec:

- **`session-start`** — at the start of a session, scan `NEEDED.md` for
  `[owner:ai]` items that an agentic session could now complete, and surface them.
- **`session-end`** — before ending a session, update `NEEDED.md`: add any new
  items that need the owner, tick off what was finished, and keep the markers.
- **`markdown-checkup`** — review every markdown file in the repo and clean out
  stale information, update what changed, or confirm each file is still accurate
  and on point (paying special attention to `NEEDED.md`, `about-project.md`,
  `scaling.md`, and `monetization.md`).

## Git workflow (every session)

Every repo's `CLAUDE.md` and `session-end` skill carry these rules:

- **Commit frequently** in small, coherent steps — never batch a whole session
  into one commit.
- **At the end of every session, push and merge to `main`** so the change
  redeploys immediately (these projects auto-deploy from `main` on Vercel).
- **Delete the merged / old branch** (local and remote) after merging, to keep
  the repo clean. Never leave stale branches behind.

`newProject.md` (rendered in OwnDashboard's Projects card) is the onboarding
version of this spec for brand-new repos.
