// The file every "App costs & scaling" card reads from a repo root.
export const STACK_AND_SCALING_FILE = "stack-and-scaling.md";

// The prompt to hand another Claude Code session so it writes / updates the
// stack-and-scaling.md in a repo root. Surfaced via a "Copy prompt" button on
// cards whose repo doesn't have the file yet.
export const STACK_AND_SCALING_PROMPT = `Add a file named \`stack-and-scaling.md\` to the root of this repository (update it if it already exists). Inspect the actual code, package manifests, infrastructure/config, environment variables, and deployment files to determine what is really used — do not guess. Write everything in English, and follow this exact structure:

# <App name>

<A one-line description of what the app does. Max 160 characters.>

## Tech stack & current costs
List every technology, hosting provider, managed service, API, and significant dependency the app uses in production. For each one add a bullet with:
- what it is and what it's used for,
- the plan/tier currently used (e.g. "Vercel Hobby", "Supabase Free", "Neon Free"),
- the current monthly cost in USD,
- its limitations on that tier (rate limits, quotas, seats, storage/bandwidth caps, cold starts) — write "none relevant" if there genuinely aren't any.

## Total current cost
The total estimated monthly cost to run the app today, with the usage assumptions behind it (roughly how much traffic/data it currently handles).

## Scaling — options & costs
For each part of the stack that would become a bottleneck, list the realistic scaling options (upgrade tier, vertical vs horizontal, managed vs self-hosted, alternative providers) and the approximate monthly cost of each option.

## At 100 active users
Describe concretely what 100 active users would mean for this specific app:
- which tier limit or bottleneck you'd hit first,
- what would break, slow down, or need upgrading,
- the new estimated monthly cost,
- how the architecture would have to be transformed (services to add or replace, caching, queues/background jobs, database scaling/read replicas, CDN, etc.).

Be specific and quantitative — use real numbers, tiers, and $/month wherever possible, based on this repository's actual stack.`;
