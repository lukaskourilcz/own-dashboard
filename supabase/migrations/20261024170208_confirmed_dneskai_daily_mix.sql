-- Own-only daily volume edits. Absent configuration is distinct from a failed
-- read; simultaneous first saves serialize on the owned project row.
create function public.save_dneskai_daily_mix(p_project uuid,p_expected_updated_at timestamptz,p_mix jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid := (select auth.uid());
 source public.marketing_dneskai_daily_mix; saved public.marketing_dneskai_daily_mix;
 desired_slots text[]; source_version timestamptz; source_values jsonb; outcome text := 'saved';
 allowed text[] := array['newsPerDay','educationPerDay','slots'];
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_project is null or (p_expected_updated_at is not null and not isfinite(p_expected_updated_at))
  or p_mix is null or jsonb_typeof(p_mix)<>'object' or octet_length(p_mix::text)>2048
  or not p_mix ?& allowed or p_mix-allowed<>'{}'::jsonb
  or jsonb_typeof(p_mix->'newsPerDay')<>'number' or p_mix->>'newsPerDay' !~ '^[0-4]$'
  or jsonb_typeof(p_mix->'educationPerDay')<>'number' or p_mix->>'educationPerDay' !~ '^[0-4]$'
  or jsonb_typeof(p_mix->'slots')<>'array' then
  raise exception 'Invalid daily mix' using errcode='22023';
 end if;
 if jsonb_array_length(p_mix->'slots') not between 1 and 4
  or exists(select 1 from jsonb_array_elements(p_mix->'slots') slot where jsonb_typeof(slot)<>'string' or slot#>>'{}' not in ('08:00','12:30','17:00','20:00')) then
  raise exception 'Invalid daily mix' using errcode='22023';
 end if;
 desired_slots := array(select jsonb_array_elements_text(p_mix->'slots'));
 if cardinality(desired_slots)<>(select count(distinct slot) from unnest(desired_slots) slot)
  or (p_mix->>'newsPerDay')::integer+(p_mix->>'educationPerDay')::integer>cardinality(desired_slots) then
  raise exception 'Invalid daily mix' using errcode='22023';
 end if;
 perform id from public.projects where id=p_project and user_id=actor for update;
 if not found then raise exception 'Project unavailable' using errcode='42501'; end if;
 select * into source from public.marketing_dneskai_daily_mix where user_id=actor and project_id=p_project for update;
 if found then
  source_version := source.updated_at;
  source_values := jsonb_build_object('newsPerDay',source.news_per_day,'educationPerDay',source.education_per_day,'slots',source.slots);
  saved := source;
  if source_values=p_mix then null; -- An identical retry is a receipt, never another version.
  elsif source.updated_at is distinct from p_expected_updated_at then outcome := 'conflict';
  else
   update public.marketing_dneskai_daily_mix set news_per_day=(p_mix->>'newsPerDay')::integer,
    education_per_day=(p_mix->>'educationPerDay')::integer,slots=desired_slots,
    updated_at=greatest(clock_timestamp(),source.updated_at+interval '1 microsecond')
   where user_id=actor and project_id=p_project returning * into saved;
   if not found or saved.updated_at<=source.updated_at then raise exception 'Daily mix save unconfirmed' using errcode='40001'; end if;
  end if;
 else
  if p_expected_updated_at is not null then raise exception 'Daily mix unavailable' using errcode='40001'; end if;
  insert into public.marketing_dneskai_daily_mix(user_id,project_id,news_per_day,education_per_day,slots)
   values(actor,p_project,(p_mix->>'newsPerDay')::integer,(p_mix->>'educationPerDay')::integer,desired_slots) returning * into saved;
  if not found then raise exception 'Daily mix save unconfirmed' using errcode='40001'; end if;
 end if;
 if saved.user_id<>actor or saved.project_id<>p_project or not isfinite(saved.updated_at)
  or (outcome='saved' and jsonb_build_object('newsPerDay',saved.news_per_day,'educationPerDay',saved.education_per_day,'slots',saved.slots)<>p_mix) then
  raise exception 'Daily mix save unconfirmed' using errcode='40001';
 end if;
 return jsonb_build_object('kind',outcome,'projectId',p_project,'ownerId',actor,'sourceVersion',source_version,
  'read',jsonb_build_object('stored',true,'version',saved.updated_at,
   'mix',jsonb_build_object('newsPerDay',saved.news_per_day,'educationPerDay',saved.education_per_day,'slots',saved.slots)));
end $$;
revoke all on function public.save_dneskai_daily_mix(uuid,timestamptz,jsonb) from public,anon,service_role;
grant execute on function public.save_dneskai_daily_mix(uuid,timestamptz,jsonb) to authenticated;
comment on function public.save_dneskai_daily_mix(uuid,timestamptz,jsonb) is
 'Own-only captured-version daily mix save, serialized first creation, exact persisted receipt and no-op retry; no provider or publication work.';
