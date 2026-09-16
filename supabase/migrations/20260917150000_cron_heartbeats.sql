-- Cron heartbeats — make a silently dead schedule visible.
--
-- A cron that stops firing produces no error anywhere: nothing runs, so nothing
-- reports. The fix is an outbound push: after a successful run the server pings
-- an external push monitor (Uptime Kuma, self-hosted, MIT), and the monitor —
-- not this app — is what alerts when the ping stops arriving. The same run also
-- stamps `last_success_at`, so the dashboard can show each cron's freshness
-- beside its cost without any external service at all.
--
-- Both columns are optional. A cron with an empty `heartbeat_url` is simply
-- unmonitored: nothing is pinged and the UI says so rather than implying a
-- health it cannot know.

alter table public.crons
  add column if not exists heartbeat_url text not null default '';

alter table public.crons
  add column if not exists last_success_at timestamptz;

comment on column public.crons.heartbeat_url is
  'Uptime Kuma push-monitor URL. Pinged server-side only after a successful run, so a failed or never-invoked cron lets the monitor alert. Treat as a credential: never returned by the public registry endpoint.';

comment on column public.crons.last_success_at is
  'When this cron last reported a successful run, stamped by the server-side run log. Null means it has never reported one.';

-- Only the monitored rows are ever scanned together (the heartbeat dispatch and
-- the staleness read), so the index stays partial and small.
create index if not exists crons_user_heartbeat_idx
  on public.crons (user_id)
  where heartbeat_url <> '';

-- Resolving a run to its cron by endpoint is how the app's own Vercel crons get
-- a heartbeat without hard-coding row ids in the route handlers.
create index if not exists crons_user_endpoint_idx
  on public.crons (user_id, endpoint)
  where endpoint <> '';

-- No new policy: the four own-only `crons` policies already cover every column,
-- and writes to the two new columns happen either as the owner (the cron form)
-- or with the service role from the run log.
