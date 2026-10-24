-- Confirm the two project classification controls without returning private
-- notes or replacing another field. A stale edit must be reviewed again.
create function public.set_project_preferences(p_id uuid,p_expected_updated_at timestamptz,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
  actor uuid := (select auth.uid());
  source public.projects; saved public.projects;
  prior jsonb := '{}'::jsonb; values_after jsonb; field text;
  outcome text := 'saved';
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>128
    or p_patch='{}'::jsonb or (p_patch-array['is_active','engagement'])<>'{}'::jsonb then
    raise exception 'Invalid project preferences' using errcode='22023';
  end if;
  if (p_patch ? 'is_active' and jsonb_typeof(p_patch->'is_active')<>'boolean')
    or (p_patch ? 'engagement' and (jsonb_typeof(p_patch->'engagement')<>'string' or p_patch->>'engagement' not in ('own','client'))) then
    raise exception 'Invalid project preferences' using errcode='22023';
  end if;
  select * into source from public.projects where id=p_id and user_id=actor for update;
  if not found then raise exception 'Project not found' using errcode='42501'; end if;
  for field in select jsonb_object_keys(p_patch) loop
    prior := prior || jsonb_build_object(field,to_jsonb(source)->field);
  end loop;
  saved := source;
  if prior=p_patch then
    null; -- Repeat an already committed request without another write.
  elsif source.updated_at<>p_expected_updated_at then
    outcome := 'conflict';
  else
    update public.projects set
      is_active=case when p_patch ? 'is_active' then (p_patch->>'is_active')::boolean else source.is_active end,
      engagement=case when p_patch ? 'engagement' then p_patch->>'engagement' else source.engagement end,
      updated_at=greatest(clock_timestamp(),source.updated_at+interval '1 millisecond')
    where id=p_id and user_id=actor returning * into saved;
    if not found or saved.updated_at<=source.updated_at
      or (to_jsonb(saved)-array['is_active','engagement','updated_at']) is distinct from (to_jsonb(source)-array['is_active','engagement','updated_at'])
      or (not p_patch ? 'is_active' and saved.is_active is distinct from source.is_active)
      or (not p_patch ? 'engagement' and saved.engagement is distinct from source.engagement)
      or not to_jsonb(saved) @> p_patch then
      raise exception 'Project preferences save not confirmed' using errcode='40001';
    end if;
  end if;
  values_after := case when outcome='saved' then p_patch else prior end;
  return jsonb_build_object('kind',outcome,'id',source.id,'user_id',actor,
    'values',values_after,'previous_values',prior,'source_updated_at',source.updated_at,'updated_at',saved.updated_at);
end $$;
revoke all on function public.set_project_preferences(uuid,timestamptz,jsonb) from public,anon,service_role;
grant execute on function public.set_project_preferences(uuid,timestamptz,jsonb) to authenticated;
comment on function public.set_project_preferences(uuid,timestamptz,jsonb) is
  'Own-only active/engagement compare-and-save; compact field/version receipts, stale conflicts and repeatable no-op retries.';
