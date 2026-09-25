---
name: session-end
description: Before ending a session, update NEEDED.md with owner-needed items and finished tasks, keeping the shared marker format.
---

# session-end

Run before **ending** an agentic session on this repo.

1. Update `NEEDED.md`: tick off (`- [x]`) anything finished this session, and add
   any newly-discovered items that need the **owner** as `[owner:me]` tasks.
2. Keep every task's markers intact and in the shared format (below). Give new
   tasks an `[imp:N]`, `[owner:…]`, `[time:…]`, and `[kind:…]`.
3. If the stack, cost, or monetization picture changed, note it in
   `about-project.md`, `scaling.md`, or `monetization.md`.

## NEEDED.md marker format (shared across all repos)

`- [ ] **Title** — desc. [imp:1-5] [owner:me|ai] [time:30m] [kind:K]`
`[kind:K]` ∈ `setup` `deploy` `legal` `content` `decision`.

## Git workflow (every session)

- **Commit frequently** in small, coherent steps — never batch a whole session into one commit.
- **At the end of every session, push and merge to `main`** so the change redeploys immediately (this project auto-deploys from `main` on Vercel).
- **Delete the merged / old branch** (local and remote) after merging, to keep the repo clean. Never leave stale branches behind.
