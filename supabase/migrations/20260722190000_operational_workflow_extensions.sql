-- Operational workflow extensions: subscription classification, project
-- communication history, and a deliberately narrow VPS agent task queue.

alter table public.subscriptions
  add column if not exists category_group text not null default 'other'
    check (category_group in ('development', 'entertainment', 'business', 'infrastructure', 'productivity', 'finance', 'other')),
  add column if not exists importance text not null default 'useful'
    check (importance in ('essential', 'useful', 'optional'));

update public.subscriptions
set category_group = case
  when lower(coalesce(category, '') || ' ' || name) ~ '(netflix|spotify|youtube|music|stream|entertain|zábav)' then 'entertainment'
  when lower(coalesce(category, '') || ' ' || name) ~ '(claude|codex|supabase|vercel|github|figma|developer|development|vývoj)' then 'development'
  when lower(coalesce(category, '') || ' ' || name) ~ '(osvč|osvc|business|účet|account|office|legal|tax|daň)' then 'business'
  when lower(coalesce(category, '') || ' ' || name) ~ '(hosting|domain|server|cloud|storage|infrastr)' then 'infrastructure'
  when lower(coalesce(category, '') || ' ' || name) ~ '(bank|finance|payment|invoice|faktur)' then 'finance'
  when lower(coalesce(category, '') || ' ' || name) ~ '(productiv|calendar|notes|poznám)' then 'productivity'
  else category_group
end
where category_group = 'other';

alter table public.projects
  add column if not exists dev_url text;

create table if not exists public.project_communications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  channel text not null default 'email'
    check (channel in ('email', 'call', 'meeting', 'chat', 'other')),
  direction text not null default 'outbound'
    check (direction in ('inbound', 'outbound', 'internal')),
  contact text,
  subject text,
  summary text not null,
  next_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_communications_project_idx
  on public.project_communications (user_id, project_id, occurred_at desc);

alter table public.project_communications enable row level security;
grant select, insert, update, delete on public.project_communications to authenticated;
grant all on public.project_communications to service_role;

create policy "project communications select own" on public.project_communications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "project communications insert own" on public.project_communications
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  );
create policy "project communications update own" on public.project_communications
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  );
create policy "project communications delete own" on public.project_communications
  for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  instructions text not null check (char_length(instructions) between 1 and 12000),
  agent_name text,
  priority smallint not null default 3 check (priority between 1 and 5),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  result text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_tasks_queue_idx
  on public.agent_tasks (user_id, status, priority desc, created_at);
create index if not exists agent_tasks_project_idx
  on public.agent_tasks (user_id, project_id, created_at desc);

alter table public.agent_tasks enable row level security;
grant select, insert, update, delete on public.agent_tasks to authenticated;
grant all on public.agent_tasks to service_role;

create policy "agent tasks select own" on public.agent_tasks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "agent tasks insert own" on public.agent_tasks
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and status = 'queued'
    and (project_id is null or exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    ))
  );
create policy "agent tasks update own" on public.agent_tasks
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    ))
  );
create policy "agent tasks delete own" on public.agent_tasks
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.claim_agent_task(
  p_user_id uuid,
  p_agent_name text default null
)
returns setof public.agent_tasks
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with next_task as (
    select task.id
    from public.agent_tasks task
    where task.user_id = p_user_id
      and task.status = 'queued'
      and (
        task.agent_name is null
        or btrim(task.agent_name) = ''
        or task.agent_name = nullif(btrim(p_agent_name), '')
      )
    order by task.priority desc, task.created_at
    for update skip locked
    limit 1
  )
  update public.agent_tasks task
  set status = 'running',
      agent_name = coalesce(nullif(btrim(p_agent_name), ''), task.agent_name),
      claimed_at = now(),
      updated_at = now()
  from next_task
  where task.id = next_task.id
  returning task.*;
end;
$$;

revoke all on function public.claim_agent_task(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_agent_task(uuid, text) to service_role;
