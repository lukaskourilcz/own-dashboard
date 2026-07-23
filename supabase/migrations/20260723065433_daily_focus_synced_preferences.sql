-- Daily professional focus, global tasks, synchronized UI preferences, and
-- permanent per-user removal of globally scraped job listings.

alter table public.todos
  drop constraint if exists todos_importance_check;

alter table public.todos
  add constraint todos_importance_check
  check (importance is null or importance between 1 and 6);

alter table public.todos
  add column if not exists is_global boolean not null default false;

create or replace function public.enforce_global_todo_priority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_global then
    new.importance := 6;
    new.project_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_global_todo_priority on public.todos;
create trigger enforce_global_todo_priority
  before insert or update of is_global, importance, project_id
  on public.todos
  for each row execute function public.enforce_global_todo_priority();

-- Every control exposed in Settings is stored with the owner preference row.
-- Local storage remains only a resilient cache for offline/preview rendering.
alter table public.user_preferences
  add column if not exists language text not null default 'cs'
    check (language in ('cs', 'en')),
  add column if not exists theme text not null default 'light'
    check (theme in ('light', 'dark')),
  add column if not exists display_currency text not null default 'CZK',
  add column if not exists hidden_navigation text[] not null default '{}',
  add column if not exists navigation_order text[] not null default '{}',
  add column if not exists navigation_collapsed boolean not null default false,
  add column if not exists dashboard_layout text[] not null default
    array['today-hero', 'todos', 'kpi', 'quick-add', 'work-attention', 'subscriptions', 'calendar', 'goals']::text[],
  add column if not exists tasks_per_category integer not null default 5
    check (tasks_per_category in (0, 3, 5, 10)),
  add column if not exists cv_url_cs text not null default '',
  add column if not exists cv_url_en text not null default '';

-- A deleted listing is an owner-specific permanent tombstone. The scraper may
-- keep the shared source row fresh, but it cannot make the listing reappear.
alter table public.job_user_state
  drop constraint if exists job_user_state_state_check;

update public.job_user_state
set state = 'deleted'
where state = 'hidden';

alter table public.job_user_state
  add constraint job_user_state_state_check
  check (state in ('shortlisted', 'deleted'));

create table if not exists public.daily_focus_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  focus_date date not null default current_date,
  generation integer not null default 1 check (generation > 0),
  created_at timestamptz not null default now(),
  unique (user_id, focus_date, generation),
  unique (id, user_id)
);

create index if not exists daily_focus_sets_user_date_idx
  on public.daily_focus_sets (user_id, focus_date desc, generation desc);

alter table public.daily_focus_sets enable row level security;

create policy "daily_focus_sets select own" on public.daily_focus_sets
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "daily_focus_sets insert own" on public.daily_focus_sets
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "daily_focus_sets delete own" on public.daily_focus_sets
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.daily_focus_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  todo_id uuid references public.todos(id) on delete set null,
  position smallint not null check (position between 1 and 7),
  title_snapshot text not null,
  project_name_snapshot text,
  importance_snapshot smallint check (
    importance_snapshot is null or importance_snapshot between 1 and 6
  ),
  waiting_since timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (set_id, user_id)
    references public.daily_focus_sets(id, user_id) on delete cascade,
  unique (set_id, position),
  unique (set_id, todo_id)
);

create index if not exists daily_focus_items_set_idx
  on public.daily_focus_items (set_id, position);
create index if not exists daily_focus_items_todo_idx
  on public.daily_focus_items (todo_id)
  where todo_id is not null;

alter table public.daily_focus_items enable row level security;

create policy "daily_focus_items select own" on public.daily_focus_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "daily_focus_items insert own" on public.daily_focus_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "daily_focus_items update own" on public.daily_focus_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "daily_focus_items delete own" on public.daily_focus_items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Returns the current set for today, creating it on first use. Regeneration
-- creates a new generation. Candidates are random within priority bands, with
-- priority 6 (GLOBAL) always considered first. Inactive-project tasks stay out.
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
    hashtextextended('daily-focus:' || v_user_id::text || ':' || v_today::text, 0)
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
    case when candidates.done then now() else null end
  from (
    select
      t.id,
      t.title,
      t.importance,
      t.done,
      coalesce(t.generated_at, t.created_at) as waiting_since,
      p.name as project_name,
      random() as random_order
    from public.todos t
    left join public.projects p
      on p.id = t.project_id and p.user_id = v_user_id
    where t.user_id = v_user_id
      and not t.done
      and (
        t.is_global
        or t.project_id is null
        or p.is_active
      )
    order by t.importance desc nulls last, random_order
    limit 7
  ) candidates;

  return v_set_id;
end;
$$;

create or replace function public.sync_daily_focus_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date;
begin
  if new.done is distinct from old.done then
    select (
      now() at time zone coalesce(p.timezone, 'Europe/Prague')
    )::date
    into v_today
    from (select 1) seed
    left join public.user_preferences p on p.user_id = new.user_id;

    update public.daily_focus_items i
    set completed_at = case when new.done then now() else null end
    from public.daily_focus_sets s
    where i.set_id = s.id
      and i.todo_id = new.id
      and i.user_id = new.user_id
      and s.focus_date = v_today;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_daily_focus_completion on public.todos;
create trigger sync_daily_focus_completion
  after update of done on public.todos
  for each row execute function public.sync_daily_focus_completion();

revoke all on function public.create_daily_focus_set(boolean) from public;
revoke all on function public.create_daily_focus_set(boolean) from anon;
grant execute on function public.create_daily_focus_set(boolean) to authenticated;

grant select, insert, delete on public.daily_focus_sets to authenticated;
grant select, insert, update, delete on public.daily_focus_items to authenticated;
