-- Links and Ideas connect to projects, so the library says where a resource
-- was used and a project workspace says which references shaped it. One row
-- per (link, project) pair; the status separates "planned for" from "used in".
create table public.ai_link_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  link_id uuid not null references public.ai_links(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'used' check (status in ('planned','used')),
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, link_id, project_id)
);
create index ai_link_projects_project_idx on public.ai_link_projects (user_id, project_id);
create index ai_link_projects_link_idx on public.ai_link_projects (user_id, link_id);
comment on table public.ai_link_projects is 'Own-only references between library records (links, ideas) and projects.';

alter table public.ai_link_projects enable row level security;
revoke all on public.ai_link_projects from anon, authenticated;
grant select, insert, update, delete on public.ai_link_projects to authenticated, service_role;

-- Ownership is checked on the row and on both ends of the reference, so a
-- reference can never point at another user's link or project.
create policy "ai_link_projects select own" on public.ai_link_projects
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "ai_link_projects insert own" on public.ai_link_projects
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ai_links l where l.id = link_id and l.user_id = (select auth.uid()))
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
create policy "ai_link_projects update own" on public.ai_link_projects
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "ai_link_projects delete own" on public.ai_link_projects
  for delete to authenticated using ((select auth.uid()) = user_id);

-- A project's preview or launch video, stored as a link to the owner's Drive.
alter table public.projects
  add column video_url text
  check (video_url is null or video_url ~ '^https://(drive\.google\.com/|docs\.google\.com/)[^[:space:]]+$');
comment on column public.projects.video_url is 'Google Drive link to the project video; no file bytes are stored here.';
