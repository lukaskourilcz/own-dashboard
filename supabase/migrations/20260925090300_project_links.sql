-- Links a project really uses. One row per (project, library link) with a
-- role and an owner-written note on how the link helps that project. Prompts
-- and the Tools section build on these rows; a tool's per-project "how it
-- helps" is a row with role = 'tool'.
--
-- ai_links.project_relevance stays as free text for now and is deprecated in
-- favour of this table; scripts/backfill-project-links.mjs copies it here.

create table if not exists public.project_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  ai_link_id uuid not null references public.ai_links(id) on delete cascade,
  role text not null default 'uses' check (role in ('uses', 'reference', 'tool')),
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, ai_link_id)
);

create index if not exists project_links_user_idx
  on public.project_links (user_id, project_id, sort_order);
create index if not exists project_links_link_idx
  on public.project_links (ai_link_id);

alter table public.project_links enable row level security;

grant select, insert, update, delete on public.project_links to authenticated;
grant select, insert, update, delete on public.project_links to service_role;

drop policy if exists "project_links select own" on public.project_links;
create policy "project_links select own"
  on public.project_links for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "project_links insert own" on public.project_links;
create policy "project_links insert own"
  on public.project_links for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
    and exists (select 1 from public.ai_links l where l.id = ai_link_id and l.user_id = (select auth.uid()))
  );

drop policy if exists "project_links update own" on public.project_links;
create policy "project_links update own"
  on public.project_links for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
    and exists (select 1 from public.ai_links l where l.id = ai_link_id and l.user_id = (select auth.uid()))
  );

drop policy if exists "project_links delete own" on public.project_links;
create policy "project_links delete own"
  on public.project_links for delete to authenticated
  using ((select auth.uid()) = user_id);

comment on column public.ai_links.project_relevance is
  'Deprecated: owner-authored repository relevance text. Use project_links; scripts/backfill-project-links.mjs copies these rows.';
