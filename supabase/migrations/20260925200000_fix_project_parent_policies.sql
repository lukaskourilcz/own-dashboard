-- Fix the parent-ownership check in the projects insert and update policies.
--
-- 20260916094243_portfolio_works_competition_finance.sql wrote the check as
-- `exists (select 1 from public.projects parent where parent.id = parent_id
-- ...)`. Inside that subquery the unqualified `parent_id` resolves to the
-- inner row, so Postgres stored `parent.id = parent.parent_id`: the check asks
-- for a project that is its own parent. No such row exists, so every insert
-- or update that carries a non-null projects.parent_id was rejected, including
-- an ordinary edit of an existing venture subsection (Design Lab, GoVIRAL). It
-- was too strict, never too loose: no row could point at another owner's
-- project.
--
-- Both policies are recreated with the outer row named explicitly
-- (`projects.parent_id`). Everything else in them is unchanged: the owner
-- check, the organization ownership check, and the rule that a project cannot
-- be its own parent on update.

drop policy if exists "projects insert own" on public.projects;
create policy "projects insert own" on public.projects
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (organization_id is null or exists (
      select 1 from public.organizations o
      where o.id = projects.organization_id and o.user_id = (select auth.uid())
    ))
    and (parent_id is null or exists (
      select 1 from public.projects parent
      where parent.id = projects.parent_id and parent.user_id = (select auth.uid())
    ))
  );

drop policy if exists "projects update own" on public.projects;
create policy "projects update own" on public.projects
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (organization_id is null or exists (
      select 1 from public.organizations o
      where o.id = projects.organization_id and o.user_id = (select auth.uid())
    ))
    and (parent_id is null or (
      parent_id <> id
      and exists (
        select 1 from public.projects parent
        where parent.id = projects.parent_id and parent.user_id = (select auth.uid())
      )
    ))
  );
