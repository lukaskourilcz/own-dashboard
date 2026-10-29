-- Captured owner/week/version saves. Unknown legacy item keys stay intact.
create function public.save_weekly_review(p_owner uuid,p_id uuid,p_week_start date,p_expected_updated_at timestamptz,p_mode text,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid := (select auth.uid());
 source public.weekly_reviews; desired public.weekly_reviews; saved public.weekly_reviews;
 exists_before boolean; field text; entry jsonb; items_patch jsonb; stamp timestamptz;
 result jsonb; source_version timestamptz;
begin
 if actor is null or actor is distinct from p_owner then raise exception 'Weekly review unavailable' using errcode='42501'; end if;
 if p_id is null or p_week_start is null or not isfinite(p_week_start) or extract(isodow from p_week_start)<>1
  or extract(year from p_week_start) not between 1 and 9999 or p_mode is null or p_mode not in ('auto','draft','complete')
  or (p_expected_updated_at is not null and not isfinite(p_expected_updated_at))
  or p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>262144
  or (p_patch-array['summary','items'])<>'{}'::jsonb or not p_patch ? 'items' then
  raise exception 'Weekly review invalid' using errcode='22023';
 end if;
 if p_patch ? 'summary' and (jsonb_typeof(p_patch->'summary')<>'string' or length(p_patch->>'summary')>20000) then
  raise exception 'Weekly review invalid' using errcode='22023';
 end if;
 items_patch:=p_patch->'items';
 if jsonb_typeof(items_patch)<>'object' or not items_patch ? 'step'
  or (items_patch-array['step','objectives','facts','risks','decisions','priorities','followUps','sources','timeByChannel','focusRecap'])<>'{}'::jsonb
  or jsonb_typeof(items_patch->'step')<>'string' or items_patch->>'step' not in ('time','done','carry','objectives','summary') then
  raise exception 'Weekly review invalid' using errcode='22023';
 end if;
 foreach field in array array['facts','risks','decisions','priorities','followUps','sources'] loop
  if items_patch ? field then
   if jsonb_typeof(items_patch->field)<>'array' then raise exception 'Weekly review invalid' using errcode='22023'; end if;
   if jsonb_array_length(items_patch->field)>100 then raise exception 'Weekly review invalid' using errcode='22023'; end if;
   for entry in select value from jsonb_array_elements(items_patch->field) loop
    if jsonb_typeof(entry)<>'string' or length(entry#>>'{}')>2000 then raise exception 'Weekly review invalid' using errcode='22023'; end if;
   end loop;
  end if;
 end loop;
 if items_patch ? 'objectives' then
  if jsonb_typeof(items_patch->'objectives')<>'array' then raise exception 'Weekly review invalid' using errcode='22023'; end if;
  if jsonb_array_length(items_patch->'objectives')>100 then raise exception 'Weekly review invalid' using errcode='22023'; end if;
  for entry in select value from jsonb_array_elements(items_patch->'objectives') loop
   if jsonb_typeof(entry)<>'object' or (entry-array['id','text','done','carriedFrom'])<>'{}'::jsonb
    or not entry ?& array['id','text','done'] or jsonb_typeof(entry->'id')<>'string' or length(entry->>'id') not between 1 and 200
    or jsonb_typeof(entry->'text')<>'string' or length(btrim(entry->>'text')) not between 1 and 2000
    or jsonb_typeof(entry->'done')<>'boolean'
    or (entry ? 'carriedFrom' and (jsonb_typeof(entry->'carriedFrom')<>'string' or length(entry->>'carriedFrom') not between 1 and 200)) then
    raise exception 'Weekly review invalid' using errcode='22023';
   end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(items_patch->'objectives') e group by e->>'id' having count(*)>1) then
   raise exception 'Weekly review invalid' using errcode='22023';
  end if;
 end if;
 if items_patch ? 'timeByChannel' then
  entry:=items_patch->'timeByChannel';
  if jsonb_typeof(entry)<>'object' or not entry ?& array['minutes','unmatchedEvents','source']
   or (entry-array['minutes','unmatchedEvents','source'])<>'{}'::jsonb or jsonb_typeof(entry->'minutes')<>'object'
   or not ((entry->'minutes') ?& array['client','project','admin']) or ((entry->'minutes')-array['client','project','admin'])<>'{}'::jsonb
   or jsonb_typeof(entry->'source')<>'string' or entry->>'source' not in ('google','unavailable')
   or jsonb_typeof(entry->'unmatchedEvents')<>'number' then raise exception 'Weekly review invalid' using errcode='22023'; end if;
  if (entry->>'unmatchedEvents')::numeric not between 0 and 1000000 or (entry->>'unmatchedEvents')::numeric<>trunc((entry->>'unmatchedEvents')::numeric) then
   raise exception 'Weekly review invalid' using errcode='22023'; end if;
  foreach field in array array['client','project','admin'] loop
   if jsonb_typeof(entry->'minutes'->field)<>'number' then raise exception 'Weekly review invalid' using errcode='22023'; end if;
   if (entry->'minutes'->>field)::numeric not between 0 and 1000000000 then raise exception 'Weekly review invalid' using errcode='22023'; end if;
  end loop;
 end if;
 if items_patch ? 'focusRecap' then
  entry:=items_patch->'focusRecap';
  if jsonb_typeof(entry)<>'object' or not entry ?& array['completed','total','days']
   or (entry-array['completed','total','days'])<>'{}'::jsonb then raise exception 'Weekly review invalid' using errcode='22023'; end if;
  foreach field in array array['completed','total','days'] loop
   if jsonb_typeof(entry->field)<>'number' then raise exception 'Weekly review invalid' using errcode='22023'; end if;
   if (entry->>field)::numeric not between 0 and 49 or (entry->>field)::numeric<>trunc((entry->>field)::numeric) then raise exception 'Weekly review invalid' using errcode='22023'; end if;
  end loop;
  if (entry->>'days')::int>7 or (entry->>'completed')::int>(entry->>'total')::int then raise exception 'Weekly review invalid' using errcode='22023'; end if;
 end if;
 -- The absent-row case needs the same owner/week lock as two concurrent creates.
 perform pg_advisory_xact_lock(hashtextextended('weekly-review:'||actor::text||':'||p_week_start::text,0));
 select * into source from public.weekly_reviews where user_id=actor and week_start=p_week_start for update;
 exists_before:=found; source_version:=source.updated_at;
 if (exists_before and source.id<>p_id) or (not exists_before and p_expected_updated_at is not null) then
  return jsonb_build_object('kind','conflict','ownerId',actor,'weekStart',p_week_start,'sourceUpdatedAt',source_version,'review',null);
 end if;
 stamp:=clock_timestamp(); desired:=source;
 if not exists_before then
  desired.id:=p_id; desired.user_id:=actor; desired.week_start:=p_week_start; desired.summary:=''; desired.items:='{}'; desired.status:='draft';
  desired.created_at:=stamp; desired.updated_at:=stamp; desired.completed_at:=null;
 end if;
 desired.summary:=case when p_patch ? 'summary' then p_patch->>'summary' else desired.summary end;
 desired.items:=desired.items||items_patch;
 if p_mode='draft' then desired.status:='draft'; desired.completed_at:=null;
 elsif p_mode='complete' then desired.status:='completed'; desired.completed_at:=coalesce(desired.completed_at,stamp); end if;
 if exists_before and (to_jsonb(desired)-'updated_at')=(to_jsonb(source)-'updated_at') then
  saved:=source; -- Already committed values are an acknowledged no-op, even after an ambiguous response.
 elsif exists_before and source.updated_at is distinct from p_expected_updated_at then
  return jsonb_build_object('kind','conflict','ownerId',actor,'weekStart',p_week_start,'sourceUpdatedAt',source_version,'review',null);
 elsif exists_before then
  desired.updated_at:=greatest(stamp,source.updated_at+interval '1 millisecond');
  update public.weekly_reviews set summary=desired.summary,items=desired.items,status=desired.status,completed_at=desired.completed_at,updated_at=desired.updated_at
   where id=source.id and user_id=actor returning * into saved;
  if not found or to_jsonb(saved) is distinct from to_jsonb(desired) then raise exception 'Weekly review save unconfirmed' using errcode='40001'; end if;
 else
  insert into public.weekly_reviews(id,user_id,week_start,summary,items,status,completed_at,created_at,updated_at)
   values(desired.id,actor,p_week_start,desired.summary,desired.items,desired.status,desired.completed_at,desired.created_at,desired.updated_at) returning * into saved;
  if not found or to_jsonb(saved) is distinct from to_jsonb(desired) then raise exception 'Weekly review save unconfirmed' using errcode='40001'; end if;
 end if;
 result:=jsonb_build_object('kind','saved','ownerId',actor,'weekStart',p_week_start,'sourceUpdatedAt',source_version,'review',to_jsonb(saved));
 if octet_length(result::text)>524288 then raise exception 'Weekly review limit' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function public.save_weekly_review(uuid,uuid,date,timestamptz,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_weekly_review(uuid,uuid,date,timestamptz,text,jsonb) to authenticated;
