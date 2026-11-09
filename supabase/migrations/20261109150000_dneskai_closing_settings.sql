-- The DNESKAi closing slide's own settings (owner, 9 November 2026): it is added to planned posts only while the owner
-- switches it on in the Design Lab, and its words are the owner's to edit there. One row per owner, own-only RLS.
create table public.marketing_dneskai_closing (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 headline text not null default 'Sleduj' check (char_length(headline) between 1 and 24),
 body text not null default 'pro všechny novinky ze světa AI a technologií.' check (char_length(body) between 1 and 160),
 handle text not null default '@dneskai' check (handle ~ '^@[A-Za-z0-9._]{1,30}$'),
 updated_at timestamptz not null default clock_timestamp()
);
alter table public.marketing_dneskai_closing enable row level security;
revoke all on public.marketing_dneskai_closing from public, anon;
grant select, insert, update on public.marketing_dneskai_closing to authenticated;
grant all on public.marketing_dneskai_closing to service_role;
create policy "dneskai closing select own" on public.marketing_dneskai_closing for select to authenticated using ((select auth.uid()) = user_id);
create policy "dneskai closing insert own" on public.marketing_dneskai_closing for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dneskai closing update own" on public.marketing_dneskai_closing for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
