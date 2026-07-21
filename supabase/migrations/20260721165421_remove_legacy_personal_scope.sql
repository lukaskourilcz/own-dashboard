-- Run after 20260721165419_professional_restructure_core.sql.
-- This migration first snapshots every user's legacy personal data into an
-- own-only archive. The application export endpoint reads this archive after
-- the source tables are removed, so the data remains portable.

create table public.legacy_personal_archives (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  archived_at timestamptz not null default now(),
  exported_at timestamptz,
  check (jsonb_typeof(payload) = 'object')
);

alter table public.legacy_personal_archives enable row level security;
grant select, update on public.legacy_personal_archives to authenticated;
grant all on public.legacy_personal_archives to service_role;
create policy "legacy archives select own" on public.legacy_personal_archives
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "legacy archives update own" on public.legacy_personal_archives
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

insert into public.legacy_personal_archives (user_id, payload)
select
  u.id,
  jsonb_build_object(
    'schema_version', 1,
    'archived_at', now(),
    'pulse', coalesce((select jsonb_agg(to_jsonb(p) order by p.log_date) from public.daily_pulse p where p.user_id = u.id), '[]'::jsonb),
    'habits', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.streaks s where s.user_id = u.id), '[]'::jsonb),
    'habit_logs', coalesce((select jsonb_agg(to_jsonb(sl) order by sl.log_date) from public.streak_logs sl where sl.user_id = u.id), '[]'::jsonb),
    'books', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at) from public.books b where b.user_id = u.id), '[]'::jsonb),
    'book_pages', coalesce((select jsonb_agg(to_jsonb(bp) order by bp.log_date) from public.book_pages bp where bp.user_id = u.id), '[]'::jsonb),
    'couples', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.couples c where u.id in (c.user_a_id, c.user_b_id)), '[]'::jsonb),
    'couple_invites', coalesce((select jsonb_agg(to_jsonb(ci) order by ci.created_at) from public.couple_invites ci where ci.inviter_id = u.id or lower(ci.invitee_email) = lower(coalesce(u.email, ''))), '[]'::jsonb),
    'sharing_preferences', coalesce((select to_jsonb(sp) from public.sharing_prefs sp where sp.user_id = u.id), '{}'::jsonb)
  )
from auth.users u
on conflict (user_id) do update
set payload = excluded.payload, archived_at = now();

-- Restore strict own-only access before removing the sharing infrastructure.
drop policy if exists "profiles select" on public.profiles;
create policy "profiles select own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "subscriptions select own or shared" on public.subscriptions;
create policy "subscriptions select own" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "todos select own or shared" on public.todos;
create policy "todos select own" on public.todos
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "accounts select own or shared" on public.accounts;
create policy "accounts select own" on public.accounts
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "transactions select own or shared" on public.transactions;
create policy "transactions select own" on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "plans select own or shared" on public.plans;
create policy "plans select own" on public.plans
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "important_dates select" on public.important_dates;
drop policy if exists "important_dates update" on public.important_dates;
drop policy if exists "important_dates insert own" on public.important_dates;
drop policy if exists "important_dates update own" on public.important_dates;
create policy "important_dates select own" on public.important_dates
  for select to authenticated using ((select auth.uid()) = user_id);

alter table public.important_dates drop column couple_id;
alter table public.user_preferences drop column if exists notifications_streaks;

create policy "important_dates insert own" on public.important_dates
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
  );
create policy "important_dates update own" on public.important_dates
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
  );

drop table public.book_pages;
drop table public.books;
drop table public.daily_pulse;
drop table public.streak_logs;
drop table public.streaks;
drop table public.sharing_prefs;
drop table public.couple_invites;
drop table public.couples;
drop function public.is_shared_with_me(uuid, text);
