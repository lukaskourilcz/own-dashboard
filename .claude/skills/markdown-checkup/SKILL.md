---
name: markdown-checkup
description: Review every markdown file in the repo and clean stale info, update changes, or verify each is still accurate.
---

# markdown-checkup

Review **every** markdown file in the repo and, for each, either clean out
information that is no longer relevant, update what has changed, or confirm it is
still accurate and on point. Pay special attention to:

- `NEEDED.md` — remove done items, keep the marker format (below) intact.
- `about-project.md` — the tech stack must match the actual code/manifests.
- `scaling.md` — cost/scaling only (no stack); prices dated and honest.
- `monetization.md` — options and likelihoods still realistic.

Report a short per-file verdict: kept / updated / trimmed, with what changed.

## NEEDED.md marker format (shared across all repos)

`- [ ] **Title** — desc. [imp:1-5] [owner:me|ai] [time:30m] [kind:K]`
`[kind:K]` ∈ `setup` `deploy` `legal` `content` `decision`.
