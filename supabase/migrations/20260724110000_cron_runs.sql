-- Cron run log: one row per fired cron run (the app's own Vercel crons and any
-- external GitHub Actions cron that reports in via /api/crons/log). Powers the
-- Home "today's crons" + 14-day log-history panels. A retention job trims rows
-- older than two weeks.

create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Optional link to a dashboard-managed cron definition.
  cron_id uuid references public.crons(id) on delete set null,
  name text not null,
  -- What the cron hit (path or URL) — informational, shown in the log.
  endpoint text not null default '',
  status text not null default 'success'
    check (status in ('success', 'failure', 'running')),
  source text not null default 'app'
    check (source in ('app', 'vercel', 'github_actions', 'external')),
  detail text not null default '',
  fired_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists cron_runs_user_fired_idx
  on public.cron_runs (user_id, fired_at desc);

alter table public.cron_runs enable row level security;

-- The owner reads their own runs. Inserts happen server-side with the service
-- role (the Vercel crons and the token-guarded ingestion endpoint), so no
-- insert policy is granted to authenticated clients.
drop policy if exists "cron_runs select own" on public.cron_runs;
create policy "cron_runs select own" on public.cron_runs
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "cron_runs delete own" on public.cron_runs;
create policy "cron_runs delete own" on public.cron_runs
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, delete on public.cron_runs to authenticated;

-- Retention: drop runs older than 14 days. Callable on its own and scheduled
-- with pg_cron when the extension is enabled on the project.
create or replace function public.purge_old_cron_runs()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.cron_runs where fired_at < now() - interval '14 days';
$$;

revoke all on function public.purge_old_cron_runs() from public;

-- Schedule daily at 03:00 UTC when pg_cron is available (Supabase: enable the
-- pg_cron extension once, then re-run this block). No-op otherwise.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-cron-runs') then
      perform cron.unschedule('purge-cron-runs');
    end if;
    perform cron.schedule(
      'purge-cron-runs',
      '0 3 * * *',
      'select public.purge_old_cron_runs();'
    );
  end if;
end $$;
