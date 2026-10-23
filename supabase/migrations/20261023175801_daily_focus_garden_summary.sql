-- One row per owner-local day, independent of the number of regenerations.
-- Reading the latest 350 generations can omit completed days in this window.
create or replace function public.daily_focus_garden(p_until date)
returns table(focus_date date, completed boolean, completed_count integer, total integer)
language sql stable security invoker
set search_path = ''
as $$
  with counts as (
    select s.focus_date, s.generation,
      count(i.id)::integer as total,
      count(i.id) filter (where i.completed_at is not null)::integer as completed_count
    from public.daily_focus_sets s
    left join public.daily_focus_items i
      on i.set_id = s.id and i.user_id = (select auth.uid())
    where s.user_id = (select auth.uid())
      and s.focus_date between p_until - 48 and p_until
    group by s.id, s.focus_date, s.generation
  ), ranked as (
    select *, row_number() over (
      partition by focus_date
      order by (total = 7 and completed_count = 7) desc,
        completed_count desc, generation desc
    ) as position
    from counts
  )
  select focus_date, total = 7 and completed_count = 7, completed_count, total
  from ranked where position = 1 order by focus_date
$$;

revoke all on function public.daily_focus_garden(date) from public, anon, service_role;
grant execute on function public.daily_focus_garden(date) to authenticated;
