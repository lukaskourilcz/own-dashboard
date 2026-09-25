-- Remove the unused link-reference schema from the unmerged busy-carson line.
--
-- 20260916195556_link_project_references.sql (branch
-- claude/busy-carson-lc5ise, archived) created public.ai_link_projects, one row
-- per link and project, and projects.video_url, a Google Drive link to a
-- project video. It was applied to production but its application code never
-- reached main. main shipped the same relation as public.project_links (#78),
-- which the Projects workspace, the link cards and the Tools section use.
-- Production held no ai_link_projects row and no video_url value when this
-- migration was written.
--
-- The drop is guarded: it stops with an error, and removes nothing, if either
-- object holds data by the time it runs. Move such rows into project_links
-- first, or decide to keep the objects, before re-running it. On a database
-- that never had the objects it does nothing.

do $$
declare
  reference_rows bigint := 0;
  video_rows bigint := 0;
begin
  if to_regclass('public.ai_link_projects') is not null then
    execute 'select count(*) from public.ai_link_projects' into reference_rows;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'video_url'
  ) then
    execute $q$select count(*) from public.projects where nullif(btrim(video_url), '') is not null$q$
      into video_rows;
  end if;
  if reference_rows > 0 or video_rows > 0 then
    raise exception
      'Refusing to drop the link-reference schema: ai_link_projects has % row(s) and projects.video_url is set on % row(s)',
      reference_rows, video_rows;
  end if;
end
$$;

drop table if exists public.ai_link_projects;
alter table public.projects drop column if exists video_url;
