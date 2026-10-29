-- Only manual project details and their identity/URL history. Notes, order,
-- active state, financial history and relationships not named here stay intact.
create function public.save_project_details(p_id uuid,p_expected_updated_at timestamptz,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
  actor uuid := (select auth.uid());
  source public.projects; desired public.projects; saved public.projects;
  allowed text[] := array['name','slug','repo_full_name','repo_id','url','dev_url','engagement','organization_id'];
  changed_fields text[] := allowed || array['previous_slugs','previous_repo_full_names','updated_at'];
  field text; value text; source_values jsonb := '{}'::jsonb; outcome text := 'saved'; result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or p_values is null or jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>16384
    or not p_values ?& allowed or p_values-allowed<>'{}'::jsonb then
    raise exception 'Invalid project details' using errcode='22023';
  end if;
  if jsonb_typeof(p_values->'name')<>'string' or char_length(p_values->>'name') not between 1 and 200
    or btrim(p_values->>'name')<>p_values->>'name' or p_values->>'name' ~ '[[:cntrl:]]'
    or jsonb_typeof(p_values->'slug')<>'string' or char_length(p_values->>'slug') not between 1 and 100
    or p_values->>'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or jsonb_typeof(p_values->'engagement')<>'string' or p_values->>'engagement' not in ('own','client') then
    raise exception 'Invalid project details' using errcode='22023';
  end if;
  if (p_values->'repo_full_name'<>'null'::jsonb and (jsonb_typeof(p_values->'repo_full_name')<>'string'
    or char_length(p_values->>'repo_full_name')>201 or p_values->>'repo_full_name' !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'))
    or (p_values->'repo_id'<>'null'::jsonb and (jsonb_typeof(p_values->'repo_id')<>'number'
      or p_values->>'repo_id' !~ '^[1-9][0-9]{0,15}$' or (p_values->>'repo_id')::numeric>9007199254740991))
    or (p_values->'repo_id'<>'null'::jsonb and p_values->'repo_full_name'='null'::jsonb)
    or (p_values->'organization_id'<>'null'::jsonb and (jsonb_typeof(p_values->'organization_id')<>'string'
      or p_values->>'organization_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
    raise exception 'Invalid project details' using errcode='22023';
  end if;
  foreach field in array array['url','dev_url'] loop
    if p_values->field='null'::jsonb then continue; end if;
    value := p_values->>field;
    if jsonb_typeof(p_values->field)<>'string' or char_length(value)>2000
      or value !~ '^https?://[^/?#[:space:]]+([/?#].*)?$'
      or value ~ '[[:cntrl:][:space:]]' or position(chr(92) in value)>0 or value ~ '^https?://[^/?#]*@' then
      raise exception 'Invalid project details' using errcode='22023';
    end if;
  end loop;
  select * into source from public.projects where id=p_id and user_id=actor for update;
  if not found then raise exception 'Project not found' using errcode='42501'; end if;
  if cardinality(source.previous_slugs)>500 or cardinality(source.previous_repo_full_names)>500
    or exists(select 1 from unnest(source.previous_slugs || source.previous_repo_full_names) alias where alias is null or char_length(alias)>201) then
    raise exception 'Project history too large' using errcode='22023';
  end if;
  foreach field in array allowed loop source_values := source_values || jsonb_build_object(field,to_jsonb(source)->field); end loop;
  saved := source;
  if source_values=p_values then
    null; -- A lost acknowledgement can be retried without another version.
  elsif source.updated_at<>p_expected_updated_at then
    outcome := 'conflict';
  else
    desired := jsonb_populate_record(source,p_values);
    if desired.organization_id is not null then
      perform id from public.organizations where id=desired.organization_id and user_id=actor for key share;
      if not found then raise exception 'Organization unavailable' using errcode='42501'; end if;
    end if;
    if desired.slug<>source.slug and not source.slug=any(desired.previous_slugs) then
      desired.previous_slugs := array_append(desired.previous_slugs,source.slug);
    end if;
    if (desired.repo_id is distinct from source.repo_id and source.repo_id is not null)
      or (lower(coalesce(desired.repo_full_name,''))<>lower(coalesce(source.repo_full_name,''))
        and (desired.repo_id is null or source.repo_id is null or desired.repo_id<>source.repo_id)) then
      -- Relinking an unrelated/unknown repository must not adopt its tasks
      -- through an old name. Same verified numeric identity keeps history.
      desired.previous_repo_full_names := '{}';
    elsif desired.repo_full_name is distinct from source.repo_full_name and source.repo_full_name is not null
      and lower(source.repo_full_name)<>lower(coalesce(desired.repo_full_name,''))
      and not exists(select 1 from unnest(desired.previous_repo_full_names) alias where lower(alias)=lower(source.repo_full_name)) then
      desired.previous_repo_full_names := array_append(desired.previous_repo_full_names,source.repo_full_name);
    end if;
    if cardinality(desired.previous_slugs)>500 or cardinality(desired.previous_repo_full_names)>500
      or exists(select 1 from unnest(desired.previous_slugs || desired.previous_repo_full_names) alias where alias is null or char_length(alias)>201) then
      raise exception 'Project history too large' using errcode='22023';
    end if;
    update public.projects set name=desired.name,slug=desired.slug,repo_full_name=desired.repo_full_name,repo_id=desired.repo_id,
      url=desired.url,dev_url=desired.dev_url,engagement=desired.engagement,organization_id=desired.organization_id,
      previous_slugs=desired.previous_slugs,previous_repo_full_names=desired.previous_repo_full_names,
      updated_at=greatest(clock_timestamp(),source.updated_at+interval '1 millisecond')
    where id=p_id and user_id=actor returning * into saved;
    if not found or saved.updated_at<=source.updated_at
      or (to_jsonb(saved)-changed_fields) is distinct from (to_jsonb(source)-changed_fields)
      or (to_jsonb(saved)-array['updated_at']) is distinct from (to_jsonb(desired)-array['updated_at']) then
      raise exception 'Project details save not confirmed' using errcode='40001';
    end if;
  end if;
  result := jsonb_build_object('kind',outcome,'id',source.id,'user_id',actor,'source_updated_at',source.updated_at,'updated_at',saved.updated_at);
  if outcome='saved' then
    result := result || jsonb_build_object('values',p_values,'previous_slugs',to_jsonb(saved.previous_slugs),'previous_repo_full_names',to_jsonb(saved.previous_repo_full_names));
  end if;
  if octet_length(result::text)>1048576 then raise exception 'Project details receipt too large' using errcode='22023'; end if;
  return result;
end $$;
revoke all on function public.save_project_details(uuid,timestamptz,jsonb) from public,anon,service_role;
grant execute on function public.save_project_details(uuid,timestamptz,jsonb) to authenticated;
comment on function public.save_project_details(uuid,timestamptz,jsonb) is
  'Own-only manual detail compare-and-save, retained slug/verified repository history, no-op retries and metadata-only receipts; notes/order/active state remain unchanged.';
