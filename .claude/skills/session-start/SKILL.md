---
name: session-start
description: At the start of a session, scan NEEDED.md for [owner:ai] tasks an agent can now complete and surface them.
---

# session-start

Run at the **start** of an agentic session on this repo.

1. Read `NEEDED.md` and find every open task marked `[owner:ai]` — work an agent
   can complete end-to-end (no owner credentials/approvals/physical checks).
2. Surface those tasks to the user as candidates to tackle now, newest/highest
   `[imp:N]` first.
3. Skip `[owner:me]` items — those need the human.

## NEEDED.md marker format (shared across all repos)

Each task line: `- [ ] **Title** — desc. [imp:1-5] [owner:me|ai] [time:30m] [kind:K]`
- `[imp:N]` 1–5 (5 = highest) · `[owner:me|ai]` · `[time:…]` (30m/2h/…)
- `[kind:K]` one of: `setup` `deploy` `legal` `content` `decision`
