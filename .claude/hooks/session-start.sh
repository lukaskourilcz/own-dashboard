#!/bin/bash
# SessionStart hook for Claude Code on the web. Installs Node dependencies so
# lint, unit tests (vitest), and the E2E suite (@playwright/test) can run in
# remote sessions.
#
# Runs synchronously: the session waits for this to finish, so dependencies are
# guaranteed ready before the agent runs anything.
set -euo pipefail

# Only needed in the remote (web) environment; local machines manage their own
# dependencies.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Resolve the repo root (robust even if CLAUDE_PROJECT_DIR is unset).
REPO_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$REPO_DIR"

# Node dependencies — incremental install takes advantage of the cached
# container state.
npm install --no-audit --no-fund

# Playwright's browser: in the Claude Code cloud environment it is preinstalled
# at $PLAYWRIGHT_BROWSERS_PATH (chromium-1194, the build Playwright 1.56.1
# expects) and `playwright install` is disabled, so nothing is installed here.
