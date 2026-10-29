-- One complete owner week, selecting the newest generation before reading its
-- items. Regenerations cannot consume the REST row cap or multiply the recap.
create function public.weekly_focus_snapshot(p_week_start date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
 actor uuid := (select auth.uid());
 selected uuid[]; sets jsonb; result jsonb;
begin
 if actor is null then raise exception 'weekly focus unavailable' using errcode='42501'; end if;
 if p_week_start is null or not isfinite(p_week_start) or extract(isodow from p_week_start)<>1
  or extract(year from p_week_start) not between 1 and 9999 then
  raise exception 'weekly focus invalid' using errcode='22023';
 end if;
 select coalesce(array_agg(s.id),'{}'::uuid[]) into selected
 from generate_series(0,6) day_offset(n)
 cross join lateral (
  select chosen.id from public.daily_focus_sets chosen
  where chosen.user_id=actor and chosen.focus_date=p_week_start+day_offset.n
  order by chosen.generation desc limit 1
 ) s;
 -- Refuse huge legacy text before building JSON; no row is truncated or deleted.
 if exists(select 1 from public.daily_focus_items i where i.set_id=any(selected) and i.user_id=actor
  and (octet_length(i.title_snapshot)>16000 or octet_length(coalesce(i.project_name_snapshot,''))>16000)) then
  raise exception 'weekly focus limit' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'user_id',s.user_id,'focus_date',s.focus_date,'generation',s.generation,
  'items',(select coalesce(jsonb_agg(jsonb_build_object(
   'id',i.id,'user_id',i.user_id,'set_id',i.set_id,'todo_id',i.todo_id,'position',i.position,
   'title_snapshot',i.title_snapshot,'project_name_snapshot',i.project_name_snapshot,'completed_at',i.completed_at
  ) order by i.position),'[]'::jsonb)
   from public.daily_focus_items i where i.set_id=s.id and i.user_id=actor)
 ) order by s.focus_date),'[]'::jsonb) into sets
 from public.daily_focus_sets s where s.id=any(selected) and s.user_id=actor;
 result:=jsonb_build_object('ownerId',actor,'weekStart',p_week_start,'sets',sets);
 if octet_length(result::text)>524288 then raise exception 'weekly focus limit' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function public.weekly_focus_snapshot(date) from public,anon,authenticated,service_role;
grant execute on function public.weekly_focus_snapshot(date) to authenticated;
comment on function public.weekly_focus_snapshot(date) is
 'Complete invoker/RLS owner snapshot of seven calendar days: latest generation per day, at most 49 focus items, ordered positions and 512 KiB response refusal. Read only; no calendar event content or provider work.';
