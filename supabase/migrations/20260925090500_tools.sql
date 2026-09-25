-- Tools: the library links the owner really uses, with what each does, its
-- status and an optional subscription for its monthly cost. How a tool helps
-- each project is a project_links row with role = 'tool' and its note.
-- Subscription renewal dates stay explicit; nothing reads a billing provider.

create table if not exists public.tools (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ai_link_id uuid not null references public.ai_links(id) on delete cascade,
  name text,
  what_it_does text not null,
  status text not null default 'in_use' check (status in ('in_use', 'trial', 'retired')),
  subscription_id uuid references public.subscriptions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ai_link_id)
);

create index if not exists tools_user_status_idx
  on public.tools (user_id, status);
create index if not exists tools_subscription_idx
  on public.tools (subscription_id);

alter table public.tools enable row level security;

grant select, insert, update, delete on public.tools to authenticated;
grant select, insert, update, delete on public.tools to service_role;

drop policy if exists "tools select own" on public.tools;
create policy "tools select own"
  on public.tools for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "tools insert own" on public.tools;
create policy "tools insert own"
  on public.tools for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ai_links l where l.id = ai_link_id and l.user_id = (select auth.uid()))
    and (subscription_id is null or exists (select 1 from public.subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid())))
  );

drop policy if exists "tools update own" on public.tools;
create policy "tools update own"
  on public.tools for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ai_links l where l.id = ai_link_id and l.user_id = (select auth.uid()))
    and (subscription_id is null or exists (select 1 from public.subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid())))
  );

drop policy if exists "tools delete own" on public.tools;
create policy "tools delete own"
  on public.tools for delete to authenticated
  using ((select auth.uid()) = user_id);
