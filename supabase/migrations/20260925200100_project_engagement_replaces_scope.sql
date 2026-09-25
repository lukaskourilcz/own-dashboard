-- One canonical field for own versus client projects: projects.engagement.
--
-- Two unmerged lines of work classified projects twice. The 2026-09-16 branch
-- added projects.scope ('project' = own portfolio, 'work' = client engagement,
-- 'other' = any other synced repository) for a separate Works section. The
-- 2026-09-25 kickoff (#76) added projects.engagement ('own' or 'client') and
-- lists client projects in Projects behind a "Freelance - hired" divider,
-- following the owner's instruction that gym-plzen and paris-claire are the
-- client projects and every other project is the owner's own. The application
-- now reads engagement only, and the other half of scope is carried by
-- projects.portfolio_key: a row bound to the code-level portfolio registry is
-- a portfolio project, any other row is not. Nothing reads scope any more.
--
-- The drop is safe on existing data. Rows where the two fields disagree
-- (scope = 'work' but engagement = 'own') are the owner's decision recorded
-- by #76; they are listed below as a NOTICE so the migration log shows which
-- ones they were, and the owner can switch any of them to Client in the
-- project form. The column's check constraint is dropped with it.

do $$
declare
  disagreeing text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'scope'
  ) then
    execute $q$
      select string_agg(slug, ', ' order by slug)
      from public.projects
      where scope = 'work' and engagement <> 'client'
    $q$ into disagreeing;
    if disagreeing is not null then
      raise notice 'projects with scope work kept as engagement own (owner decision, #76): %', disagreeing;
    end if;
  end if;
end
$$;

alter table public.projects drop column if exists scope;
