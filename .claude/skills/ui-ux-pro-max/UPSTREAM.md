# Upstream

- Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- Commit: `3b5df7547964f0cb3424de74cff55b69039250d3`
- License: MIT (see `LICENSE`) — Copyright (c) 2024 Next Level Builder

Vendored from `.claude/skills/ui-ux-pro-max/` upstream. The only local change:
`${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/` script paths were rewritten
to the project-relative `.claude/skills/ui-ux-pro-max/`, because this copy lives in
the repo rather than in a plugin root.

Search tool: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>`
