-- Source settings only. Existing owner functions remain compatible, but all
-- write paths now lock the owned project before touching a source row.
create function marketing_private.dneskai_source_values(s public.marketing_dneskai_sources) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('sourceId',s.source_id,'kind',s.kind,'topic',s.topic,'handleOrUrl',s.handle_or_url,
  'name',s.name,'tier',s.tier,'weekdays',s.weekdays,'maxItems',s.max_items,'enabled',s.enabled)
$$;
revoke all on function marketing_private.dneskai_source_values(public.marketing_dneskai_sources) from public,anon,authenticated,service_role;

-- SECURITY DEFINER is required: authenticated has SELECT only on the table.
-- Every lookup/write binds auth.uid() and the locked, owned project explicitly.
create function public.change_dneskai_source(p_project uuid,p_action text,p_expected jsonb,p_source jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid := (select auth.uid()); expected jsonb := nullif(p_expected,'null'::jsonb); desired jsonb := nullif(p_source,'null'::jsonb);
 allowed text[] := array['sourceId','kind','topic','handleOrUrl','name','tier','weekdays','maxItems','enabled'];
 document jsonb; address text; authority text; wanted_source_id text; days smallint[];
 current_row public.marketing_dneskai_sources; saved public.marketing_dneskai_sources;
 current_values jsonb; result_values jsonb; outcome text;
begin
 if actor is null then raise exception 'source unavailable' using errcode='42501'; end if;
 if p_project is null or p_action is null or p_action not in ('save','remove')
  or (p_action='save' and desired is null) or (p_action='remove' and (expected is null or desired is not null)) then
  raise exception 'source invalid' using errcode='22023';
 end if;
 foreach document in array array[expected,desired] loop
  if document is null then continue; end if;
  if jsonb_typeof(document)<>'object' or octet_length(document::text)>8192 or not document ?& allowed or document-allowed<>'{}'::jsonb
   or jsonb_typeof(document->'sourceId')<>'string' or document->>'sourceId' !~ '^[a-z0-9][a-z0-9:._-]{0,79}$'
   or jsonb_typeof(document->'kind')<>'string' or document->>'kind' not in ('instagram','rss','html','hn','hnsearch','arxiv','bluesky','spaceflight','github','stackexchange')
   or jsonb_typeof(document->'topic')<>'string' or document->>'topic' not in ('news','education')
   or jsonb_typeof(document->'handleOrUrl')<>'string' or char_length(document->>'handleOrUrl') not between 1 and 2048
   or jsonb_typeof(document->'name')<>'string' or char_length(document->>'name') not between 1 and 120
   or btrim(document->>'name')<>document->>'name' or document->>'name' ~ '[[:cntrl:]]'
   or jsonb_typeof(document->'tier')<>'number' or document->>'tier' !~ '^[0-2]$'
   or jsonb_typeof(document->'maxItems')<>'number' or document->>'maxItems' !~ '^([1-9]|1[0-9]|20)$'
   or jsonb_typeof(document->'enabled')<>'boolean' or jsonb_typeof(document->'weekdays')<>'array' then
   raise exception 'source invalid' using errcode='22023';
  end if;
  if jsonb_array_length(document->'weekdays') not between 1 and 7
   or exists(select 1 from jsonb_array_elements(document->'weekdays') day where jsonb_typeof(day)<>'number' or day#>>'{}' !~ '^[0-6]$') then
   raise exception 'source invalid' using errcode='22023';
  end if;
  days := array(select jsonb_array_elements_text(document->'weekdays')::smallint);
  if cardinality(days)<>(select count(distinct day) from unnest(days) day) then raise exception 'source invalid' using errcode='22023'; end if;
  address := document->>'handleOrUrl';
  if document->>'kind'='instagram' then
   if address !~ '^[a-z0-9._]{1,30}$' or document->>'sourceId'<>'instagram:'||address then raise exception 'source invalid' using errcode='22023'; end if;
  else
   authority := substring(address from '^https://([^/?#]+)');
   if authority is null or authority !~ '^([[:alnum:]._-]+|\[[0-9A-Fa-f:.]+\])(:443)?$'
    or address ~ '[[:space:][:cntrl:]]' or position(chr(92) in address)>0 then raise exception 'source invalid' using errcode='22023'; end if;
  end if;
 end loop;
 wanted_source_id := coalesce(desired->>'sourceId',expected->>'sourceId');
 if expected is not null and expected->>'sourceId'<>wanted_source_id then raise exception 'source invalid' using errcode='22023'; end if;
 perform id from public.projects where id=p_project and user_id=actor for update;
 if not found then raise exception 'source unavailable' using errcode='42501'; end if;
 select * into current_row from public.marketing_dneskai_sources s where s.user_id=actor and s.project_id=p_project and s.source_id=wanted_source_id for update;
 if found then current_values := marketing_private.dneskai_source_values(current_row); end if;
 if p_action='save' then
  if current_values=desired then result_values := current_values; outcome := 'saved';
  elsif current_values is distinct from expected then result_values := current_values; outcome := 'conflict';
  elsif current_values is not null and (current_row.kind<>desired->>'kind' or current_row.handle_or_url<>desired->>'handleOrUrl') then
   raise exception 'source address changed' using errcode='22023';
  else
   days := array(select jsonb_array_elements_text(desired->'weekdays')::smallint);
   if current_values is null then
    if (select count(*) from public.marketing_dneskai_sources where user_id=actor and project_id=p_project)>=120 then raise exception 'source limit' using errcode='22023'; end if;
    insert into public.marketing_dneskai_sources(user_id,project_id,source_id,kind,topic,handle_or_url,name,tier,weekdays,max_items,enabled)
     values(actor,p_project,wanted_source_id,desired->>'kind',desired->>'topic',desired->>'handleOrUrl',desired->>'name',(desired->>'tier')::smallint,
      days,(desired->>'maxItems')::smallint,(desired->>'enabled')::boolean) returning * into saved;
   else
    update public.marketing_dneskai_sources s set topic=desired->>'topic',name=desired->>'name',tier=(desired->>'tier')::smallint,
     weekdays=days,max_items=(desired->>'maxItems')::smallint,enabled=(desired->>'enabled')::boolean,
     updated_at=greatest(clock_timestamp(),current_row.updated_at+interval '1 microsecond') where s.id=current_row.id and s.user_id=actor and s.project_id=p_project returning * into saved;
   end if;
   if not found or saved.user_id<>actor or saved.project_id<>p_project or marketing_private.dneskai_source_values(saved) is distinct from desired then
    raise exception 'source write unconfirmed' using errcode='40001';
   end if;
   result_values := marketing_private.dneskai_source_values(saved); outcome := 'saved';
  end if;
 else
  if current_values is null then outcome := 'removed';
  elsif current_values is distinct from expected then result_values := current_values; outcome := 'conflict';
  else
   delete from public.marketing_dneskai_sources s where s.id=current_row.id and s.user_id=actor and s.project_id=p_project returning * into saved;
   if not found then raise exception 'source write unconfirmed' using errcode='40001'; end if;
   outcome := 'removed';
  end if;
 end if;
 return jsonb_build_object('kind',outcome,'ownerId',actor,'projectId',p_project,'sourceId',wanted_source_id,'source',result_values);
end $$;
revoke all on function public.change_dneskai_source(uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.change_dneskai_source(uuid,text,jsonb,jsonb) to authenticated;

-- Backward-compatible callers share the same project-first lock order and cap.
-- Their captured snapshot is taken at invocation; the updated app passes the
-- snapshot from its opened form to change_dneskai_source directly instead.
create or replace function public.marketing_dneskai_source_save(p_project uuid,p_source jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare actor uuid:=(select auth.uid()); s public.marketing_dneskai_sources; expected jsonb; result jsonb;
begin
 perform id from public.projects where id=p_project and user_id=actor for update;
 if actor is null or not found then raise exception 'source unavailable'; end if;
 select * into s from public.marketing_dneskai_sources where user_id=actor and project_id=p_project and source_id=p_source->>'sourceId' for update;
 if found then expected:=marketing_private.dneskai_source_values(s); end if;
 result:=public.change_dneskai_source(p_project,'save',expected,p_source);
 if result->>'kind'<>'saved' then raise exception 'source write unconfirmed'; end if;
 select * into s from public.marketing_dneskai_sources where user_id=actor and project_id=p_project and source_id=p_source->>'sourceId';
 return jsonb_build_object('id',s.id,'sourceId',s.source_id,'enabled',s.enabled);
end $$;
create or replace function public.marketing_dneskai_source_remove(p_project uuid,p_source_id text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare actor uuid:=(select auth.uid()); s public.marketing_dneskai_sources; result jsonb;
begin
 perform id from public.projects where id=p_project and user_id=actor for update;
 if actor is null or not found then raise exception 'source unavailable'; end if;
 select * into s from public.marketing_dneskai_sources where user_id=actor and project_id=p_project and source_id=p_source_id for update;
 if not found then raise exception 'source unavailable'; end if;
 result:=public.change_dneskai_source(p_project,'remove',marketing_private.dneskai_source_values(s),null);
 if result->>'kind'<>'removed' then raise exception 'source write unconfirmed'; end if;
 return jsonb_build_object('sourceId',p_source_id,'removed',true);
end $$;
create or replace function public.marketing_dneskai_sources_seed(p_project uuid,p_rows jsonb) returns integer
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare actor uuid:=(select auth.uid()); r jsonb; result jsonb; inserted integer:=0;
begin
 perform id from public.projects where id=p_project and user_id=actor for update;
 if actor is null or not found then raise exception 'source unavailable'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or octet_length(p_rows::text)>983040 then raise exception 'source invalid'; end if;
 if jsonb_array_length(p_rows) not between 1 and 120 or jsonb_array_length(p_rows)<>(select count(distinct value->>'sourceId') from jsonb_array_elements(p_rows)) then raise exception 'source invalid'; end if;
 if exists(select 1 from public.marketing_dneskai_sources where user_id=actor and project_id=p_project) then return 0; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  result:=public.change_dneskai_source(p_project,'save',null,r);
  if result->>'kind'<>'saved' then raise exception 'source write unconfirmed'; end if;
  inserted:=inserted+1;
 end loop;
 return inserted;
end $$;
comment on function public.change_dneskai_source(uuid,text,jsonb,jsonb) is
 'Authenticated own-project source compare-and-save/remove; narrow persisted receipts, no-op retries, immutable address and a shared project lock for the 120-source cap. No source collection or provider work.';
revoke all on function public.marketing_dneskai_source_save(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketing_dneskai_source_save(uuid,jsonb) to authenticated;
revoke all on function public.marketing_dneskai_source_remove(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.marketing_dneskai_source_remove(uuid,text) to authenticated;
revoke all on function public.marketing_dneskai_sources_seed(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketing_dneskai_sources_seed(uuid,jsonb) to authenticated;
