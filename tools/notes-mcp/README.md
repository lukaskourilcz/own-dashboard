# own-dashboard notes MCP

A tiny local [MCP](https://modelcontextprotocol.io) (stdio) server that lets
Claude Code create and append **Notes** in this dashboard. Notes are stored as
BlockNote JSON in `public.notes`; this server builds that JSON from Markdown and
keeps `plain_text` in sync (so in-app search / the `tsvector` index work).

## Tools

| Tool | What it does |
| --- | --- |
| `create_note` | Create a note from `title` + `markdown` (+ optional `tags`, `pinned`) |
| `append_to_note` | Append Markdown to an existing note by `id` |
| `list_notes` | List recent notes (`id`, `title`, `tags`, `updated_at`) |

## Setup

```bash
cd tools/notes-mcp
npm install
cp .env.example .env   # then fill in the secrets (do NOT commit .env)
```

You need three values:

- `SUPABASE_URL` — `https://<project-ref>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API → `service_role` (**secret**)
- `DASHBOARD_USER_ID` — your auth user UUID (Supabase → Authentication → Users)

> The service-role key bypasses Row Level Security. Keep it on your machine,
> never commit it, and prefer the local-scope registration below.

## Connect to Claude Code

**Local scope (recommended — secret stays in `~/.claude.json`, not git):**

```bash
claude mcp add own-dashboard-notes \
  --env SUPABASE_URL=https://gcctapykhrdyxikieemn.supabase.co \
  --env SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY \
  --env DASHBOARD_USER_ID=YOUR_USER_UUID \
  -- npx -y tsx "$(pwd)/src/server.ts"
```

**Project scope:** the repo's `.mcp.json` already has an `own-dashboard-notes`
entry that reads `SUPABASE_SERVICE_ROLE_KEY` and `DASHBOARD_USER_ID` from your
environment (so no secret is committed). Just export those two vars before
launching Claude Code.

Then in a session: run `/mcp` to confirm it's connected and try
*"Create a note titled 'Standup' with `## Today\n- ship i18n`"*. The note
appears in the dashboard on the next load.

## Notes

- Logs go to **stderr** only (stdout is the JSON-RPC channel).
- ESM-only; runs via `tsx` (no build step). `npm run typecheck` to validate.
