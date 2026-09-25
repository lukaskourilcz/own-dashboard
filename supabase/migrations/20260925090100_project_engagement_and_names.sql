-- Own versus freelance projects, and the DNESKAi / devShark / boardlessAI
-- names.
--
-- engagement separates the owner's own products from client work the owner
-- was hired for; the Projects list and the sidebar show client projects last,
-- behind a divider. previous_slugs keeps renamed project URLs and cron
-- registry calls working: /projects/aifirst resolves to DNESKAi.
--
-- repo_full_name is deliberately untouched here. When the GitHub repositories
-- are renamed, the id-based auto-sync (20260925090000) updates it.

alter table public.projects
  add column if not exists engagement text not null default 'own',
  add column if not exists previous_slugs text[] not null default '{}';

alter table public.projects
  drop constraint if exists projects_engagement_check;
alter table public.projects
  add constraint projects_engagement_check
  check (engagement in ('own', 'client'));

comment on column public.projects.engagement is
  'own = the owner''s product; client = freelance work the owner was hired for.';
comment on column public.projects.previous_slugs is
  'Earlier slugs that still resolve to this project (URLs, cron registry).';

create index if not exists projects_previous_slugs_idx
  on public.projects using gin (previous_slugs);

update public.projects
set engagement = 'client', updated_at = now()
where slug in ('gym-plzen', 'paris-claire')
  and engagement <> 'client';

-- Rename by slug, per owner. A row is skipped when the owner already has a
-- project with the new slug, so the migration never violates (user_id, slug).
update public.projects project
set
  name = renamed.new_name,
  slug = renamed.new_slug,
  previous_slugs = case
    when renamed.old_slug = any(project.previous_slugs) then project.previous_slugs
    else array_append(project.previous_slugs, renamed.old_slug)
  end,
  updated_at = now()
from (
  values
    ('aifirst', 'dneskai', 'DNESKAi'),
    ('react-express-app', 'devshark', 'devShark'),
    ('quorum', 'boardlessai', 'boardlessAI')
) as renamed(old_slug, new_slug, new_name)
where project.slug = renamed.old_slug
  and not exists (
    select 1
    from public.projects taken
    where taken.user_id = project.user_id
      and taken.slug = renamed.new_slug
  );
