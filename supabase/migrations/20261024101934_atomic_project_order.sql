-- One short, owner-only transaction replaces per-row drag updates. No change
-- is accepted from a partial group, stale row or suppressed update receipt.
create function public.reorder_owned_projects(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare actor uuid := (select auth.uid()); entry jsonb; total integer; group_name text;
  expected_writes integer; actual_writes integer; result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 20000
    or octet_length(p_rows::text)>8388608 then raise exception 'Invalid project order' using errcode='22023'; end if;
  total := jsonb_array_length(p_rows);
  group_name := p_rows->0->>'engagement';
  if group_name is null or group_name not in ('own','client') then raise exception 'Invalid project order source' using errcode='22023'; end if;
  for entry in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or not(entry ?& array['id','user_id','updated_at','previous_sort_order','sort_order','engagement','parent_id','is_active'])
      or (entry-array['id','user_id','updated_at','previous_sort_order','sort_order','engagement','parent_id','is_active'])<>'{}'::jsonb
      or jsonb_typeof(entry->'id') is distinct from 'string'
      or (entry->>'id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or (entry->>'user_id') is distinct from actor::text
      or jsonb_typeof(entry->'updated_at') is distinct from 'string'
      or jsonb_typeof(entry->'previous_sort_order') is distinct from 'number'
      or (entry->>'previous_sort_order') !~ '^-?[0-9]+$'
      or (entry->>'previous_sort_order')::numeric not between -2147483648 and 2147483647
      or jsonb_typeof(entry->'sort_order') is distinct from 'number'
      or (entry->>'sort_order') !~ '^[0-9]+$'
      or (entry->>'sort_order')::numeric not between 0 and total-1
      or (entry->>'engagement') is distinct from group_name or group_name not in ('own','client')
      or entry->'parent_id' is distinct from 'null'::jsonb
      or entry->'is_active' is distinct from 'true'::jsonb then
      raise exception 'Invalid project order source' using errcode='22023'; end if;
  end loop;
  if (select count(distinct r.id) from jsonb_to_recordset(p_rows) r(id uuid))<>total
    or (select count(distinct r.sort_order) from jsonb_to_recordset(p_rows) r(sort_order integer))<>total then
    raise exception 'Duplicate project order source' using errcode='22023'; end if;
  -- The same row order is used by every invocation. Locks end with this RPC;
  -- no locks span a browser or provider request.
  perform p.id from public.projects p join jsonb_to_recordset(p_rows) r(id uuid) on r.id=p.id
    where p.user_id=actor order by p.id for update of p;
  if (select count(*) from public.projects where user_id=actor and is_active and parent_id is null and engagement=group_name)<>total
    or exists(select 1 from jsonb_to_recordset(p_rows) r(id uuid,updated_at timestamptz,previous_sort_order integer)
      left join public.projects p on p.id=r.id and p.user_id=actor
      where p.id is null or p.updated_at is distinct from r.updated_at or p.sort_order is distinct from r.previous_sort_order
        or not p.is_active or p.parent_id is not null or p.engagement is distinct from group_name) then
    raise exception 'Project order changed' using errcode='40001'; end if;
  select count(*) into expected_writes from jsonb_to_recordset(p_rows) r(previous_sort_order integer,sort_order integer)
    where previous_sort_order<>sort_order;
  update public.projects p set sort_order=r.sort_order,
    updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 millisecond')
    from jsonb_to_recordset(p_rows) r(id uuid,sort_order integer)
    where p.id=r.id and p.user_id=actor and p.sort_order<>r.sort_order;
  get diagnostics actual_writes = row_count;
  if actual_writes<>expected_writes or exists(
    select 1 from jsonb_to_recordset(p_rows) r(id uuid,updated_at timestamptz,previous_sort_order integer,sort_order integer)
    left join public.projects p on p.id=r.id and p.user_id=actor
    where p.id is null or p.sort_order is distinct from r.sort_order or not p.is_active or p.parent_id is not null
      or p.engagement is distinct from group_name
      or (r.previous_sort_order<>r.sort_order and p.updated_at<=r.updated_at)
      or (r.previous_sort_order=r.sort_order and p.updated_at is distinct from r.updated_at)
  ) then raise exception 'Project order not confirmed' using errcode='40001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'user_id',p.user_id,'sort_order',p.sort_order,'updated_at',p.updated_at) order by p.id),'[]'::jsonb)
    into result from public.projects p join jsonb_to_recordset(p_rows) r(id uuid,previous_sort_order integer,sort_order integer) on p.id=r.id
    where p.user_id=actor and r.previous_sort_order<>r.sort_order;
  return result;
end $$;
revoke all on function public.reorder_owned_projects(jsonb) from public,anon,service_role;
grant execute on function public.reorder_owned_projects(jsonb) to authenticated;
comment on function public.reorder_owned_projects(jsonb) is
  'Atomic captured-version order for one complete owned active top-level group; changed rows only, invoker RLS, 20,000 rows/8 MiB, no automatic retry.';
