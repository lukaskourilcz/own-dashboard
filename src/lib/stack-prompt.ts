// The file every "App costs & scaling" card reads from a repo root.
export const STACK_AND_SCALING_FILE = "stack-and-scaling.md";

// The prompt to hand another Claude Code session so it writes / updates the
// stack-and-scaling.md in a repo root. Surfaced via a "Copy prompt" button on
// cards whose repo doesn't have the file yet.
export const STACK_AND_SCALING_PROMPT = `Add or update \`stack-and-scaling.md\` at this repository root. Inspect the actual code, manifests, infrastructure configuration, environment variables, cron/deployment files, and documented product scope; do not guess what is deployed or paid.

Write a concise English operating reference with:

1. Product name and one-sentence scope.
2. The actual production stack.
3. A current-cost table that separates fixed platform cost, variable usage, and excluded items. If live billing is unavailable, say so explicitly and describe free-tier versus reliable-production scenarios.
4. Official provider links and the date every price was checked.
5. Realistic 1-owner, 100-user, and 1,000-user planning bands with assumptions. Make clear when a user-count scenario conflicts with the current product model.
6. Measured upgrade triggers for database, hosting/functions, AI, email, caching/rate limiting, analytics, and monitoring.
7. Cost controls the owner should configure.

Never prescribe a replica, queue, cache, larger database, or paid plan solely from user count. Tie architecture changes to observed latency, storage, connection, retry, concurrency, token, or quota pressure. Keep estimates honest: distinguish official prices from calculated scenarios, and do not call a service free when its public pricing is unavailable.`;
