/**
 * The standards a new project (and the agent building it) should follow so it
 * plugs into OwnDashboard immediately. Rendered in the Projects panel and
 * mirrored to `newProject.md` at the repo root. Keep the two in sync.
 */
export const NEW_PROJECT_GUIDE = `# New project guide — wiring a repo into OwnDashboard

Standards every new project (and the agent building it) should follow so it plugs into OwnDashboard immediately: tasks import, the Knowledge / Scaling / Monetization tabs render, and the Overview shows live traffic. Keep these files at the **repository root**.

## The four root markdown files

Create all four — OwnDashboard reads and renders each.

### \`about-project.md\` — what it is + the stack
A one-paragraph summary, then \`## Tech stack\` and \`## Third-party libraries\` as bullet lists (\`Name — what it does\`). This is the **only** place the tech stack lives. Keep it ~25 lines.

### \`NEEDED.md\` — owner/agent action items
A markdown checklist, one task per line, in the shared marker format:

\`- [ ] **Title** — description. [imp:1-5] [owner:me|ai] [time:30m] [kind:K]\`

- \`[imp:N]\` 1–5 (5 = highest) · \`[owner:me|ai]\` (ai = an agent can do it end-to-end) · \`[time:…]\` (30m / 2h) · \`[kind:K]\` ∈ \`setup\` \`deploy\` \`legal\` \`content\` \`decision\`.
- Ticked items (\`- [x]\`) count as done. OwnDashboard imports these as tasks.

### \`scaling.md\` — cost & scaling (keep it brief)
Cost/scaling only (the stack is in \`about-project.md\`). ~20 lines: a one-line intro, a compact **What it costs** summary, 2–3 **When to scale** triggers, one **Keep costs down** line. Date the prices and stay honest.

### \`monetization.md\` — how it could earn
A short framing sentence, then a table of options for this project — \`Option | Likelihood of income | Possible earnings | Pros | Cons\` — then a one-line recommendation. Options e.g. GitHub Sponsors, ads, subscriptions, buy-me-a-coffee, one-off sales, consulting / lead-gen. Be honest; mark options that don't apply.

## Wire it to OwnDashboard

- **Deploy on Vercel** from \`main\`, with the git repo linked.
- **Enable Vercel Web Analytics** on the project so the Overview **Traffic** card shows visitors / page views (\`VERCEL_API_TOKEN\` is set once in OwnDashboard's env).
- In OwnDashboard, add the project and set its **repository** (\`owner/name\`) — that's how tasks, docs, and traffic are all matched.

## Skills every repo carries (\`.claude/skills/\`)

- **\`session-start\`** — scan \`NEEDED.md\` for \`[owner:ai]\` tasks an agent can do now and surface them.
- **\`session-end\`** — update \`NEEDED.md\` (finished + newly-needed owner items) and follow the git workflow below.
- **\`markdown-checkup\`** — review every markdown file: trim stale info, update, or verify it's still accurate.

Mirror the common tooling the other repos share where it fits: a design-system skill, a visual-QA / accessibility reviewer, a release-validation check, a product-context skill, and \`preview-video\`.

## Git workflow (every session)

- **Commit frequently** in small, coherent steps — never batch a whole session into one commit.
- **At the end of every session, push and merge to \`main\`** so the change redeploys immediately (these projects auto-deploy from \`main\` on Vercel).
- **Delete the merged / old branch** (local and remote) after merging, to keep the repo clean. Never leave stale branches behind.
`;
