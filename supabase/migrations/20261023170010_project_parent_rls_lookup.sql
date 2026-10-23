-- PostgreSQL 18 can recurse when a project write policy expands a subquery
-- back into projects. Keep the lookup behind a non-inlined SQL function.
-- This is SECURITY INVOKER: ordinary owner RLS still applies to the lookup.
create or replace function public.project_parent_is_owned(p_parent uuid)
returns boolean
language sql stable security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.projects
    where id = p_parent and user_id = (select auth.uid())
  )
$$;

revoke all on function public.project_parent_is_owned(uuid) from public, anon, service_role;
grant execute on function public.project_parent_is_owned(uuid) to authenticated;

alter policy "projects insert own" on public.projects with check (
  (select auth.uid()) = user_id
  and (organization_id is null or exists (
    select 1 from public.organizations o
    where o.id = projects.organization_id and o.user_id = (select auth.uid())
  ))
  and (parent_id is null or public.project_parent_is_owned(parent_id))
);

alter policy "projects update own" on public.projects with check (
  (select auth.uid()) = user_id
  and (organization_id is null or exists (
    select 1 from public.organizations o
    where o.id = projects.organization_id and o.user_id = (select auth.uid())
  ))
  and (parent_id is null or (
    parent_id <> id and public.project_parent_is_owned(parent_id)
  ))
);
