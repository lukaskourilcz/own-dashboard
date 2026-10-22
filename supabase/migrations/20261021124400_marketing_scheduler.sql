-- One tick endpoint for every scheduled marketing duty (#120, owner decision 4 of #110: pg_cron in
-- Supabase calls POST /api/marketing/tick; n8n keeps no timer).
--
-- marketing_ticks is the measurement: one row per accepted tick with what each category did and
-- which failed. Its primary key is the tick id the caller sends, so a replayed or retried tick is
-- recognised and does nothing. The scheduler keeps 14 days of rows.
--
-- marketing_scheduler_state holds one lease per category, so two concurrent ticks never run the
-- same category at once, plus the next time a category may run again (media backoff, collection
-- retryAfterSeconds) and a small state object (the brief run already handled, jobs that cannot be
-- claimed, Instagram refreshes that must not be retried).
--
-- Both tables are own-only: the owner reads them, only service_role writes, through the functions
-- below. Neither table ever holds a secret, token, source text or URL.

create table public.marketing_ticks (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check (kind in ('minute','daily')),
 started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 did jsonb not null default '[]'::jsonb check (jsonb_typeof(did)='array' and jsonb_array_length(did)<=20 and pg_column_size(did)<=16384),
 errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors)='array' and jsonb_array_length(errors)<=20 and pg_column_size(errors)<=8192),
 check (finished_at is null or finished_at>=started_at)
);
create index marketing_ticks_recent on public.marketing_ticks(user_id,started_at desc);
alter table public.marketing_ticks enable row level security;
revoke all on public.marketing_ticks from public,anon,authenticated;
grant select on public.marketing_ticks to authenticated;
grant select,insert,update,delete on public.marketing_ticks to service_role;
create policy owner_read on public.marketing_ticks for select to authenticated using ((select auth.uid())=user_id);

create table public.marketing_scheduler_state (
 user_id uuid not null references auth.users(id) on delete cascade,
 category text not null check (category in ('collection','media','briefs','generation','publishing','reconciliation','token','renewal')),
 holder uuid,
 lease_until timestamptz,
 next_allowed_at timestamptz,
 state jsonb not null default '{}'::jsonb check (jsonb_typeof(state)='object' and pg_column_size(state)<=8192),
 updated_at timestamptz not null default clock_timestamp(),
 primary key (user_id,category),
 check ((holder is null)=(lease_until is null))
);
alter table public.marketing_scheduler_state enable row level security;
revoke all on public.marketing_scheduler_state from public,anon,authenticated;
grant select on public.marketing_scheduler_state to authenticated;
grant select,insert,update,delete on public.marketing_scheduler_state to service_role;
create policy owner_read on public.marketing_scheduler_state for select to authenticated using ((select auth.uid())=user_id);
