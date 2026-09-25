-- Prompts are grouped by the kind of job they do and carry the library links
-- an agent should open. The copy action combines a prompt, an optional
-- project and these links; no model is called anywhere.

alter table public.prompts
  add column if not exists kind text not null default 'other';

alter table public.prompts
  drop constraint if exists prompts_kind_check;
alter table public.prompts
  add constraint prompts_kind_check
  check (kind in (
    'design',
    'audit',
    'competition',
    'ux-ui',
    'analysis',
    'documentation',
    'new-project',
    'seo',
    'marketing',
    'other'
  ));

comment on column public.prompts.kind is
  'Kind of job: design, audit, competition, ux-ui, analysis, documentation, new-project, seo, marketing or other.';

create table if not exists public.prompt_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  ai_link_id uuid not null references public.ai_links(id) on delete cascade,
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prompt_id, ai_link_id)
);

create index if not exists prompt_links_user_idx
  on public.prompt_links (user_id, prompt_id, sort_order);
create index if not exists prompt_links_link_idx
  on public.prompt_links (ai_link_id);

alter table public.prompt_links enable row level security;

grant select, insert, update, delete on public.prompt_links to authenticated;
grant select, insert, update, delete on public.prompt_links to service_role;

drop policy if exists "prompt_links select own" on public.prompt_links;
create policy "prompt_links select own"
  on public.prompt_links for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "prompt_links insert own" on public.prompt_links;
create policy "prompt_links insert own"
  on public.prompt_links for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.prompts pr where pr.id = prompt_id and pr.user_id = (select auth.uid()))
    and exists (select 1 from public.ai_links l where l.id = ai_link_id and l.user_id = (select auth.uid()))
  );

drop policy if exists "prompt_links update own" on public.prompt_links;
create policy "prompt_links update own"
  on public.prompt_links for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.prompts pr where pr.id = prompt_id and pr.user_id = (select auth.uid()))
    and exists (select 1 from public.ai_links l where l.id = ai_link_id and l.user_id = (select auth.uid()))
  );

drop policy if exists "prompt_links delete own" on public.prompt_links;
create policy "prompt_links delete own"
  on public.prompt_links for delete to authenticated
  using ((select auth.uid()) = user_id);
