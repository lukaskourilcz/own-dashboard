# External setup checklist

These steps require accounts or secrets and are intentionally not automated by repository code.

## Supabase

- Link the intended project and apply migrations in order.
- Set the site URL and allowed auth redirects for local and production domains.
- Enable Google and/or GitHub providers only if those integrations are required.
- Verify RLS with two test users before production rollout.
- Set `SUPABASE_SERVICE_ROLE_KEY` only in the server deployment environment.

## Google Calendar

- Enable Google Calendar API.
- Add the Supabase auth callback URI to the OAuth client.
- Configure calendar event plus user email/profile scopes.
- Add local and production app callback URLs in Supabase.

## GitHub

- Enable the Supabase GitHub provider for repository materialization and NEEDED.md workflows.
- Configure OAuth callback/redirect URLs and grant only the repository permissions the workflow needs.

## Bank sync

- Configure the GoCardless/Nordigen credentials expected by the existing bank routes.
- Test requisition callbacks against the production domain and verify transaction deduplication before enabling broadly.

## AI

- Set `ANTHROPIC_API_KEY`, or an Anthropic-compatible gateway plus `ANTHROPIC_BASE_URL`.
- Optionally pin `AI_INTENT_MODEL`, `AI_ENRICHMENT_MODEL`, and `AI_SYNTHESIS_MODEL`.
- Review provider retention terms before allowing any sensitive-context workflow.

## Notifications, email, and monitoring

- Set Resend sender/domain credentials before enabling renewal emails.
- Set `CRON_SECRET` and verify scheduled requests include the expected authorization.
- Configure Sentry DSNs plus organization/project identifiers if monitoring is desired.
- Review Vercel cron schedules and deployment-region/timezone assumptions.

## Future brand, domain, and repository rename

OwnDashboard remains the temporary confirmed name. If a replacement name is approved, update `src/lib/brand.ts` first, then perform these external steps manually:

- Rename the Vercel project and attach the intended production domain; keep the old domain redirecting during the transition.
- Update `NEXT_PUBLIC_APP_URL`, Supabase Site URL, and every Supabase Auth redirect allowlist entry.
- Change the Supabase project display name only; do not rotate its URL or keys solely for branding.
- Update Google OAuth application name, authorized JavaScript origins, consent-screen domains, and local/production callback URIs.
- Update GitHub OAuth application name, homepage, and callback URL.
- If the GitHub repository itself is renamed, update the local `origin`, deployment linkage, badges, and any repository-scoped GitHub Actions secrets.
- Add the new production domain to PostHog's allowed/configured domains and verify that no captured payload contains private record content.
- Update Sentry project/environment release settings and allowed origins without exposing DSNs to unauthorized contexts.
- Verify the Resend sending domain, sender identity, and branded templates after DNS validation.
- Update external cron consumers and monitors to the new domain without changing their `CRON_SECRET` contract.
- Reinstall or refresh the PWA after deploy so cached manifest names and icons are replaced; keep the previous service-worker/cache migration behavior intact.

None of these external rename/domain steps are performed by the repository implementation.

## Post-deploy smoke test

Sign in, create an organization and Tugedr opportunity, convert it to a project, open `/projects/[slug]`, route an Inbox item, generate and separately save a weekly review, create an invoice, download every JSON export scope plus a transactions CSV, inspect integration status without exposing tokens, verify Google/GitHub callbacks, and confirm a second user cannot read or link to the first user's rows.
