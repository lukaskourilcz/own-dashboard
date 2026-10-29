-- Complete bounded collections in one statement snapshot and HTTP response.
-- JSON aggregation avoids PostgREST's row cap without raising the project-wide
-- API limit. The entity/order/bound whitelist is server-owned, never caller SQL.
create function public.read_owned_collection(p_entity text) returns jsonb
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

-- Save a prompt and its resource list together. Versions and complete source
-- link identities protect against stale or incomplete editors. A client id
-- makes an identical retry safe after an ambiguous HTTP response.
create function public.save_prompt_document(
  p_id uuid, p_creating boolean, p_header jsonb, p_links jsonb,
  p_expected_updated_at timestamptz default null,
  p_expected_link_ids uuid[] default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  saved public.prompts;
  proposed public.prompts;
  normalized jsonb;
  previous_links jsonb;
  current_ids uuid[];
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_creating is null or jsonb_typeof(p_header) is distinct from 'object'
    or jsonb_typeof(p_links) is distinct from 'array' then
    raise exception 'Invalid prompt document' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_header) k where not(k=any(array[
    'name','description','body','kind','project_id','is_public'])))
    or not(p_header ?& array['name','description','body','kind','project_id','is_public'])
    or nullif(btrim(p_header->>'name'),'') is null
    or nullif(btrim(p_header->>'body'),'') is null
    or length(p_header->>'name')>120 or length(p_header->>'description')>160
    or length(p_header->>'body')>1000000 or jsonb_array_length(p_links)>1000
    or jsonb_typeof(p_header->'name') is distinct from 'string'
    or jsonb_typeof(p_header->'description') is distinct from 'string'
    or jsonb_typeof(p_header->'body') is distinct from 'string'
    or jsonb_typeof(p_header->'kind') is distinct from 'string'
    or jsonb_typeof(p_header->'is_public') is distinct from 'boolean' then
    raise exception 'Invalid prompt fields' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_links) x where
    jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'ai_link_id') is distinct from 'string'
    or jsonb_typeof(x->'note') is distinct from 'string' or length(x->>'note')>300) then
    raise exception 'Invalid prompt resources' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('ai_link_id',(x->>'ai_link_id')::uuid,
    'note',btrim(x->>'note'),'sort_order',n-1) order by n),'[]'::jsonb)
    into normalized from jsonb_array_elements(p_links) with ordinality as entries(x,n);
  if (select count(distinct x->>'ai_link_id') from jsonb_array_elements(normalized) x)
      <>jsonb_array_length(normalized) then
    raise exception 'Duplicate prompt resources' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':prompt:' || p_id::text,0));
  select * into saved from public.prompts where id=p_id and user_id=actor for update;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('ai_link_id',ai_link_id,'note',note,
      'sort_order',sort_order) order by sort_order,created_at,id),'[]'::jsonb),
      coalesce(array_agg(id order by id),array[]::uuid[])
      into previous_links,current_ids from public.prompt_links where prompt_id=p_id and user_id=actor;
    if to_jsonb(saved) @> p_header and previous_links=normalized then
      return jsonb_build_object('prompt',to_jsonb(saved),'links',
        (select coalesce(jsonb_agg(to_jsonb(l) order by sort_order,created_at,id),'[]'::jsonb)
         from public.prompt_links l where l.prompt_id=p_id and l.user_id=actor));
    end if;
    if p_creating or p_expected_updated_at is distinct from saved.updated_at or p_expected_link_ids is null
      or current_ids is distinct from (select coalesce(array_agg(x order by x),array[]::uuid[]) from unnest(p_expected_link_ids) x) then
      raise exception 'Prompt changed; reopen before editing' using errcode='40001';
    end if;
  elsif not p_creating then
    raise exception 'Prompt not found' using errcode='P0002';
  end if;
  proposed:=jsonb_populate_record(saved,p_header);
  if p_creating then
    insert into public.prompts(id,user_id,name,description,body,kind,project_id,is_public)
      values(p_id,actor,proposed.name,proposed.description,proposed.body,proposed.kind,
        proposed.project_id,proposed.is_public) returning * into saved;
  else
    update public.prompts set name=proposed.name,description=proposed.description,body=proposed.body,
      kind=proposed.kind,project_id=proposed.project_id,is_public=proposed.is_public,updated_at=clock_timestamp()
      where id=p_id and user_id=actor returning * into saved;
  end if;
  -- Upsert before removing obsolete rows; every step is still one transaction.
  -- Keep ids/creation dates of existing resources instead of replacing them.
  insert into public.prompt_links(user_id,prompt_id,ai_link_id,note,sort_order)
    select actor,p_id,(x->>'ai_link_id')::uuid,x->>'note',(x->>'sort_order')::int
    from jsonb_array_elements(normalized) x
    on conflict(prompt_id,ai_link_id) do update set note=excluded.note,
      sort_order=excluded.sort_order,updated_at=clock_timestamp();
  delete from public.prompt_links old where old.prompt_id=p_id and old.user_id=actor
    and not exists(select 1 from jsonb_array_elements(normalized) x where (x->>'ai_link_id')::uuid=old.ai_link_id);
  return jsonb_build_object('prompt',to_jsonb(saved),'links',
    (select coalesce(jsonb_agg(to_jsonb(l) order by sort_order,created_at,id),'[]'::jsonb)
     from public.prompt_links l where l.prompt_id=p_id and l.user_id=actor));
end;
$$;
revoke all on function public.save_prompt_document(uuid,boolean,jsonb,jsonb,timestamptz,uuid[]) from public,anon,service_role;
grant execute on function public.save_prompt_document(uuid,boolean,jsonb,jsonb,timestamptz,uuid[]) to authenticated;

-- Curated imports compare the complete owner library inside the transaction;
-- a stale browser or simultaneous import cannot create duplicate names.
create function public.add_curated_prompts(p_templates jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_templates) is distinct from 'array' then
    raise exception 'Invalid curated prompts' using errcode='22023';
  end if;
  if jsonb_array_length(p_templates)>100 or exists(select 1 from jsonb_array_elements(p_templates) x where
    jsonb_typeof(x) is distinct from 'object'
    or jsonb_typeof(x->'name') is distinct from 'string'
    or jsonb_typeof(x->'description') is distinct from 'string'
    or jsonb_typeof(x->'body') is distinct from 'string'
    or jsonb_typeof(x->'kind') is distinct from 'string'
    or nullif(btrim(x->>'name'),'') is null or nullif(btrim(x->>'body'),'') is null
    or length(x->>'name')>120 or length(x->>'description')>160 or length(x->>'body')>1000000) then
    raise exception 'Invalid curated prompt fields' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':curated-prompts',0));
  with templates as (
    select distinct on (lower(btrim(x->>'name'))) btrim(x->>'name') as name,
      btrim(x->>'description') as description,btrim(x->>'body') as body,x->>'kind' as kind
      from jsonb_array_elements(p_templates) with ordinality entries(x,n)
      order by lower(btrim(x->>'name')),n
  ), inserted as (
    insert into public.prompts(user_id,name,description,body,kind,is_public)
      select actor,t.name,t.description,t.body,t.kind,true from templates t
      where not exists(select 1 from public.prompts p where p.user_id=actor and lower(btrim(p.name))=lower(t.name))
      returning *
  ) select coalesce(jsonb_agg(to_jsonb(inserted) order by created_at,id),'[]'::jsonb) into result from inserted;
  return result;
end;
$$;
revoke all on function public.add_curated_prompts(jsonb) from public,anon,service_role;
grant execute on function public.add_curated_prompts(jsonb) to authenticated;
