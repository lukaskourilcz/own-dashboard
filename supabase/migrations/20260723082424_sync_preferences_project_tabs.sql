-- Make UI preferences reliably available through the Data API and add the
-- owner-synchronized project-workspace tab visibility setting.

alter table public.user_preferences
  add column if not exists hidden_project_tabs text[] not null default '{}';

alter table public.user_preferences
  drop constraint if exists user_preferences_hidden_project_tabs_check;
alter table public.user_preferences
  add constraint user_preferences_hidden_project_tabs_check
  check (
    hidden_project_tabs <@ array[
      'overview',
      'tasks',
      'activity',
      'communication',
      'repository',
      'operations',
      'finance',
      'knowledge'
    ]::text[]
  );

alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences select own" on public.user_preferences;
create policy "user_preferences select own" on public.user_preferences
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "user_preferences insert own" on public.user_preferences;
create policy "user_preferences insert own" on public.user_preferences
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_preferences update own" on public.user_preferences;
create policy "user_preferences update own" on public.user_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.user_preferences to authenticated;

-- Daily focus uses the same canonical project assignment as the Tasks screen:
-- an explicit project_id first, then the active project whose repository
-- matches an imported NEEDED.md task. Unassigned manual tasks are not mixed
-- into the project draw; GLOBAL tasks remain eligible at priority 6.
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
            and t.repo_full_name is not null
            and project.repo_full_name is not null
            and lower(project.repo_full_name) = lower(t.repo_full_name)
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
