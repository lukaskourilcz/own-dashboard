// The file every "App costs & scaling" card reads from a repo root.
export const STACK_AND_SCALING_FILE = "stack-and-scaling.md";

// The prompt to hand another Claude Code session so it writes / updates the
// stack-and-scaling.md in a repo root. Surfaced via a "Copy prompt" button on
// cards whose repo doesn't have the file yet.
export const STACK_AND_SCALING_PROMPT = `Add a file named \`stack-and-scaling.md\` to the root of this repository (update it if it already exists). Inspect the actual code, package manifests, infrastructure/config, environment variables, and deployment files to determine what is really used — do not guess.

Keep it SHORT: the whole file must be readable in one glance — a title, a one-line description, then 5–6 bullets and nothing else. No long prose, no per-dependency breakdown, no extra headings. Each bullet is a single line; if it won't fit on one line, cut detail until it does. Write in English and follow this exact structure:

# <App name>

<one-line description of what the app does — max 120 characters>

- **Now:** <total $/month to run it today> — <the hosting/service tiers in one short phrase>, at <current users/traffic assumption>.
- **Stack:** <the key production services, separated by " · ">.
- **First ceiling:** <the single limit or blocker you'd hit first, and why>.
- **At 100 users:** <new $/month> — <the 1–3 upgrades that actually cost money>.
- **At 1,000 users:** <new $/month> — <the main architecture changes needed: read replica, caching, queue, CDN, etc.>.
- **Watch:** <the one or two costs/bottlenecks that scale with usage rather than sitting on a flat free tier>.

Use real numbers, tiers, and $/month from this repository's actual stack.`;
