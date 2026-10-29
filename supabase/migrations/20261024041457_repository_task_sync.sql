-- Preserve an assignee adopted from an indented source continuation. Existing
-- tasks retain their legacy source-line fallback; no existing row is rewritten.
alter table public.todos add column needed_assignee text check(needed_assignee in ('me','ai'));

create function public.sync_repository_tasks(p_rows jsonb,p_remove jsonb default '[]'::jsonb,p_scanned text[] default '{}'::text[]) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid := (select auth.uid()); entry jsonb; incoming jsonb; inserted jsonb;
  requested uuid[]; eligible uuid[]; deleted uuid[]; result jsonb;
  fields text[] := array['user_id','title','category','done','source','repo_id','repo_full_name','repo_owner','repo_name','repo_url','needed_raw','generated_at','due_date','importance','estimated_minutes','task_kind','needed_assignee'];
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_remove) is distinct from 'array'
    or jsonb_array_length(p_rows)>5000 or jsonb_array_length(p_remove)>20000
    or octet_length(p_rows::text)+octet_length(p_remove::text)>8388608
    or p_scanned is null or cardinality(p_scanned)>500
    or exists(select 1 from unnest(p_scanned) id where id is null or id !~ '^[0-9]{1,100}$') then
    raise exception 'Invalid repository synchronization' using errcode='22023'; end if;
  for entry in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(entry) is distinct from 'object' or not(entry ?& fields)
      or exists(select 1 from jsonb_object_keys(entry) k where not(k=any(fields)))
      or entry->>'user_id' is distinct from actor::text
      or entry->'done' is distinct from 'false'::jsonb or entry->>'source' is distinct from 'github'
      or exists(select 1 from unnest(array['title','category','repo_id','repo_full_name','repo_owner','repo_name','repo_url','needed_raw','generated_at','due_date']) k where jsonb_typeof(entry->k) is distinct from 'string')
      or length(btrim(entry->>'title')) not between 1 and 500 or length(entry->>'needed_raw') not between 1 and 10000
      or (entry->>'repo_id') !~ '^[0-9]{1,100}$'
      or length(entry->>'repo_owner') not between 1 and 100 or length(entry->>'repo_name') not between 1 and 100
      or entry->>'repo_full_name' is distinct from (entry->>'repo_owner')||'/'||(entry->>'repo_name')
      or entry->>'category' is distinct from entry->>'repo_name'
      or length(entry->>'repo_url')>2048 or entry->>'repo_url' !~ '^https://github[.]com/'
      or entry->>'due_date' !~ '^\d{4}-\d{2}-\d{2}$'
      or jsonb_typeof(entry->'importance') not in ('number','null')
      or (entry->>'importance' is not null and (entry->>'importance')::integer not between 1 and 5)
      or jsonb_typeof(entry->'estimated_minutes') not in ('number','null')
      or (entry->>'estimated_minutes' is not null and (entry->>'estimated_minutes')::integer not between 1 and 100000)
      or jsonb_typeof(entry->'task_kind') not in ('string','null')
      or (entry->>'task_kind' is not null and entry->>'task_kind' not in ('setup','deploy','legal','content','decision'))
      or jsonb_typeof(entry->'needed_assignee') not in ('string','null')
      or (entry->>'needed_assignee' is not null and entry->>'needed_assignee' not in ('me','ai')) then
      raise exception 'Invalid repository task' using errcode='22023'; end if;
    -- Cast dates/timestamps before any delete, not only rows to be inserted.
    if to_char((entry->>'due_date')::date,'YYYY-MM-DD') is distinct from entry->>'due_date'
      or not isfinite((entry->>'generated_at')::timestamptz) then raise exception 'Invalid repository task date' using errcode='22023'; end if;
  end loop;
  for entry in select value from jsonb_array_elements(p_remove) loop
    if jsonb_typeof(entry) is distinct from 'object' or entry->>'user_id' is distinct from actor::text
      or jsonb_typeof(entry->'id') is distinct from 'string'
      or entry->>'id' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or entry->>'source' is distinct from 'github' or entry->'done' is distinct from 'false'::jsonb
      or not coalesce(entry->>'repo_id'=any(p_scanned),false) then
      raise exception 'Invalid stale task source' using errcode='22023'; end if;
  end loop;
  select coalesce(array_agg((r->>'id')::uuid order by (r->>'id')::uuid),'{}'::uuid[]) into requested from jsonb_array_elements(p_remove) r;
  if (select count(distinct id) from unnest(requested) id)<>cardinality(requested) then raise exception 'Duplicate stale task' using errcode='22023'; end if;
  -- Serialize both import entry points; no lock spans a GitHub request.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('repository-tasks:'||actor::text,0));
  perform t.id from public.todos t where t.user_id=actor and t.id=any(requested) order by t.id for update;
  select coalesce(array_agg(t.id order by t.id),'{}'::uuid[]) into eligible from public.todos t
    join jsonb_populate_recordset(null::public.todos,p_remove) r on t.id=r.id
    where t.user_id=actor and t.source='github' and not t.done and not coalesce(t.is_global,false)
      and t.needed_raw is not null and to_jsonb(t)=to_jsonb(r)
      and not exists(select 1 from jsonb_populate_recordset(null::public.todos,p_rows) fresh where fresh.repo_id=t.repo_id and fresh.needed_raw=t.needed_raw);
  with removed as (delete from public.todos where user_id=actor and id=any(eligible) returning id)
    select coalesce(array_agg(id order by id),'{}'::uuid[]) into deleted from removed;
  if deleted is distinct from eligible then raise exception 'Task removal not confirmed' using errcode='40001'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.repo_id,r.needed_raw),'[]'::jsonb) into incoming from (
    select distinct on (fresh.repo_id,fresh.needed_raw) fresh.* from jsonb_populate_recordset(null::public.todos,p_rows) fresh
    where not exists(select 1 from public.todos t where t.user_id=actor and t.source='github' and t.repo_id=fresh.repo_id
      and (t.needed_raw=fresh.needed_raw or (t.needed_raw is null and lower(btrim(t.title))=lower(btrim(fresh.title)))))
    order by fresh.repo_id,fresh.needed_raw
  ) r;
  if (select count(*) from public.todos where user_id=actor)+jsonb_array_length(incoming)>20000 then
    raise exception 'Task collection exceeds complete read bound' using errcode='54000'; end if;
  with added as (
    insert into public.todos(user_id,title,category,done,source,repo_id,repo_full_name,repo_owner,repo_name,repo_url,needed_raw,generated_at,due_date,importance,estimated_minutes,task_kind,needed_assignee)
    select actor,r.title,r.category,false,'github',r.repo_id,r.repo_full_name,r.repo_owner,r.repo_name,r.repo_url,r.needed_raw,r.generated_at,r.due_date,r.importance,r.estimated_minutes,r.task_kind,r.needed_assignee
    from jsonb_populate_recordset(null::public.todos,incoming) r returning *
  ) select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into inserted from added a;
  if jsonb_array_length(inserted)<>jsonb_array_length(incoming) or exists(
    select 1 from jsonb_array_elements(inserted) saved left join jsonb_populate_recordset(null::public.todos,incoming) expected
      on expected.repo_id=saved->>'repo_id' and expected.needed_raw=saved->>'needed_raw'
    where expected.repo_id is null or exists(select 1 from unnest(fields) k where saved->k is distinct from to_jsonb(expected)->k)
  ) then raise exception 'Task insertion not confirmed' using errcode='40001'; end if;
  result := jsonb_build_object('inserted',inserted,'deleted_ids',to_jsonb(deleted),'retained_ids',to_jsonb(array(select unnest(requested) except select unnest(deleted))));
  if octet_length(result::text)>10485760 then raise exception 'Task receipt exceeds complete read bound' using errcode='54000'; end if;
  return result;
end $$;
revoke all on function public.sync_repository_tasks(jsonb,jsonb,text[]) from public,anon,service_role;
grant execute on function public.sync_repository_tasks(jsonb,jsonb,text[]) to authenticated;
