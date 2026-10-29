-- Complete bounded collections in one statement snapshot and HTTP response.
-- JSON aggregation avoids PostgREST's row cap without raising the project-wide
-- API limit. The entity/order/bound whitelist is server-owned, never caller SQL.
create or replace function public.read_owned_collection(p_entity text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  maximum integer;
  ordering text;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  case p_entity
    when 'transactions' then maximum:=20000; ordering:='occurred_on desc,id desc';
    when 'invoices' then maximum:=10000; ordering:='issue_date desc,number desc,id desc';
    when 'invoice_items' then maximum:=50000; ordering:='invoice_id,position,id';
    when 'prompts' then maximum:=10000; ordering:='created_at desc,id desc';
    when 'prompt_links' then maximum:=20000; ordering:='sort_order,created_at,id';
    when 'project_links' then maximum:=20000; ordering:='sort_order,created_at,id';
    when 'ai_links' then maximum:=10000; ordering:='created_at desc,id desc';
    when 'ai_categories' then maximum:=1000; ordering:='sort_order,id';
    when 'repo_notes' then maximum:=10000; ordering:='sort_order,created_at,id';
    when 'repo_links' then maximum:=10000; ordering:='created_at,id';
    when 'todos' then maximum:=20000; ordering:='created_at desc,id desc';
    else raise exception 'Unsupported collection' using errcode='22023';
  end case;
  execute format('select coalesce(jsonb_agg(to_jsonb(owned) order by %s),''[]''::jsonb)
    from (select * from public.%I where user_id=$1 order by %s limit $2) owned',
    ordering,p_entity,ordering) into result using actor,maximum+1;
  if jsonb_array_length(result)>maximum or octet_length(result::text)>10*1024*1024 then
    raise exception 'Collection exceeds the complete read bound' using errcode='54000';
  end if;
  return result;
end;
$$;
revoke all on function public.read_owned_collection(text) from public,anon,service_role;
grant execute on function public.read_owned_collection(text) to authenticated;
comment on function public.read_owned_collection(text) is
  'Whitelisted own-only collections under invoker RLS, one statement snapshot, explicit row and 10 MiB JSON bounds; never returns partial data.';

-- Compare canonical full records inside a short transaction. No row locks
-- survive, or are held across, the upstream GitHub request.
create function public.consume_repository_records(p_entity text,p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid := (select auth.uid()); entry jsonb; requested uuid[]; eligible uuid[]; removed uuid[];
  predicate text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_entity not in ('repo_notes','todos') or p_entity is null then
    raise exception 'Unsupported repository collection' using errcode='22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>250
    or octet_length(p_rows::text)>1048576 then
    raise exception 'Invalid repository batch' using errcode='22023'; end if;
  for entry in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(entry) is distinct from 'object' or not(entry ?& array['id','user_id'])
      or jsonb_typeof(entry->'id') is distinct from 'string'
      or (entry->>'id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or (entry->>'user_id') is distinct from actor::text then
      raise exception 'Invalid repository source' using errcode='22023'; end if;
  end loop;
  select coalesce(array_agg((r->>'id')::uuid order by (r->>'id')::uuid),'{}'::uuid[]) into requested from jsonb_array_elements(p_rows) r;
  if (select count(distinct id) from unnest(requested) id)<>cardinality(requested) then
    raise exception 'Duplicate repository source' using errcode='22023'; end if;
  predicate := case p_entity when 'todos' then 't.done and t.source=''github''' else 'true' end;
  -- Lock owned targets in deterministic order before checking the snapshot.
  execute format('select array_agg(id order by id) from (select id from public.%I where user_id=$1 and id=any($2) order by id for update) locked',p_entity)
    into eligible using actor,requested;
  execute format('select coalesce(array_agg(t.id order by t.id),''{}''::uuid[]) from public.%I t join
    jsonb_populate_recordset(null::public.%I,$2) r on t.id=r.id
    where t.user_id=$1 and to_jsonb(t)=to_jsonb(r) and %s',p_entity,p_entity,predicate)
    into eligible using actor,p_rows;
  execute format('with deleted as (delete from public.%I where user_id=$1 and id=any($2) returning id)
    select coalesce(array_agg(id order by id),''{}''::uuid[]) from deleted',p_entity)
    into removed using actor,eligible;
  if removed is distinct from eligible then raise exception 'Repository removal not confirmed' using errcode='40001'; end if;
  return jsonb_build_object('deleted_ids',to_jsonb(removed),'retained_ids',to_jsonb(array(select unnest(requested) except select unnest(removed))));
end $$;
revoke all on function public.consume_repository_records(text,jsonb) from public,anon,service_role;
grant execute on function public.consume_repository_records(text,jsonb) to authenticated;

create function public.save_repository_note(p_id uuid,p_expected jsonb,p_body text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid := (select auth.uid()); source public.repo_notes; expected public.repo_notes; saved public.repo_notes;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_body is null or octet_length(p_body)>262144 or jsonb_typeof(p_expected) is distinct from 'object' then
    raise exception 'Invalid repository note' using errcode='22023'; end if;
  expected := jsonb_populate_record(null::public.repo_notes,p_expected);
  if expected.id is distinct from p_id or expected.user_id is distinct from actor then
    raise exception 'Invalid repository source' using errcode='22023'; end if;
  select * into source from public.repo_notes where id=p_id and user_id=actor for update;
  if not found then raise exception 'Repository note not found' using errcode='42501'; end if;
  -- An identical retry after an ambiguous response needs no second write.
  if source.body=p_body and (to_jsonb(source)-array['body','updated_at'])=(to_jsonb(expected)-array['body','updated_at']) then return to_jsonb(source); end if;
  if to_jsonb(source) is distinct from to_jsonb(expected) then raise exception 'Repository note changed' using errcode='40001'; end if;
  update public.repo_notes set body=p_body,updated_at=clock_timestamp() where id=p_id and user_id=actor returning * into saved;
  if saved.id is distinct from p_id or saved.body is distinct from p_body
    or (to_jsonb(saved)-array['body','updated_at']) is distinct from (to_jsonb(source)-array['body','updated_at']) then
    raise exception 'Repository note save not confirmed' using errcode='40001'; end if;
  return to_jsonb(saved);
end $$;
revoke all on function public.save_repository_note(uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.save_repository_note(uuid,jsonb,text) to authenticated;
