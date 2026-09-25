-- Match projects to GitHub repositories by their numeric id so a repository
-- rename updates the existing project instead of creating a second one.
--
-- repo_id is the GitHub repository id. It is filled by the Projects auto-sync
-- and by the owner-run scripts/backfill-project-repo-ids.mjs; GitHub keeps the
-- id stable across renames and transfers. previous_repo_full_names keeps every
-- name the project was known by, so NEEDED.md tasks imported under an old name
-- still resolve to the project.

alter table public.projects
  add column if not exists repo_id bigint,
  add column if not exists previous_repo_full_names text[] not null default '{}';

comment on column public.projects.repo_id is
  'GitHub repository id. Stable across renames; the primary repository match.';
comment on column public.projects.previous_repo_full_names is
  'Earlier GitHub owner/name values of the linked repository, oldest first.';

create unique index if not exists projects_user_repo_id_key
  on public.projects (user_id, repo_id)
  where repo_id is not null;

-- Daily focus resolves an imported task to its project by explicit project_id,
-- then the repository id, then the current or any previous repository name.
create or replace function public.create_daily_focus_set(
  p_regenerate boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_today date;
  v_set_id uuid;
  v_generation integer;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select (
    now() at time zone coalesce(p.timezone, 'Europe/Prague')
  )::date
  into v_today
  from (select 1) seed
  left join public.user_preferences p on p.user_id = v_user_id;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'daily-focus:' || v_user_id::text || ':' || v_today::text,
      0
    )
  );

  if not p_regenerate then
    select s.id
    into v_set_id
    from public.daily_focus_sets s
    where s.user_id = v_user_id and s.focus_date = v_today
    order by s.generation desc
    limit 1;

    if v_set_id is not null then
      return v_set_id;
    end if;
  end if;

  select coalesce(max(s.generation), 0) + 1
  into v_generation
  from public.daily_focus_sets s
  where s.user_id = v_user_id and s.focus_date = v_today;

  insert into public.daily_focus_sets (user_id, focus_date, generation)
  values (v_user_id, v_today, v_generation)
  returning id into v_set_id;

  insert into public.daily_focus_items (
    set_id,
    user_id,
    todo_id,
    position,
    title_snapshot,
    project_name_snapshot,
    importance_snapshot,
    waiting_since,
    completed_at
  )
  select
    v_set_id,
    v_user_id,
    candidates.id,
    row_number() over (
      order by candidates.importance desc nulls last, candidates.random_order
    )::smallint,
    candidates.title,
    candidates.project_name,
    candidates.importance,
    candidates.waiting_since,
    null
  from (
    select
      t.id,
      t.title,
      t.importance,
      coalesce(t.generated_at, t.created_at) as waiting_since,
      p.name as project_name,
      random() as random_order
    from public.todos t
    left join lateral (
      select project.name, project.is_active
      from public.projects project
      where project.user_id = v_user_id
        and (
          project.id = t.project_id
          or (
            t.project_id is null
            and (
              (
                t.repo_id is not null
                and project.repo_id is not null
                and t.repo_id = project.repo_id::text
              )
              or (
                t.repo_full_name is not null
                and project.repo_full_name is not null
                and lower(project.repo_full_name) = lower(t.repo_full_name)
              )
              or (
                t.repo_full_name is not null
                and exists (
                  select 1
                  from unnest(project.previous_repo_full_names) previous_name
                  where lower(previous_name) = lower(t.repo_full_name)
                )
              )
            )
          )
        )
      order by case when project.id = t.project_id then 0 else 1 end
      limit 1
    ) p on true
    where t.user_id = v_user_id
      and not t.done
      and (t.is_global or p.is_active)
    order by t.importance desc nulls last, random_order
    limit 7
  ) candidates;

  return v_set_id;
end;
$$;

revoke all on function public.create_daily_focus_set(boolean) from public;
revoke all on function public.create_daily_focus_set(boolean) from anon;
grant execute on function public.create_daily_focus_set(boolean)
  to authenticated;
