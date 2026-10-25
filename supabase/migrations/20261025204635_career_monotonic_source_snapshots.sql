-- Prepared only. Public discovery listings remain global; private letters,
-- application state and permanent owner deletion tombstones are unchanged.
-- A source watermark is durable observation evidence, not an authentication
-- grant or a dummy lock row. Short database mutations share one transaction
-- lock; no provider/network work runs under it. Cleanup locks exact candidates
-- without waiting for owner triage and checks tombstones again after locking.
-- Supports the actual tombstone anti-join and the listing foreign key.
-- Native PostgreSQL 17 plans with 10,000 synthetic triage rows select it.
create index if not exists job_user_state_listing_id_idx on public.job_user_state(listing_id);
create schema if not exists career_private;
revoke all on schema career_private from public,anon,authenticated;
grant usage on schema career_private to service_role;
create table career_private.source_snapshots (
 source text primary key,
 observed_at timestamptz not null check(isfinite(observed_at)),
 snapshot_hash text not null check(snapshot_hash ~ '^[0-9a-f]{64}$'),
 changed_at timestamptz not null default clock_timestamp()
);
alter table career_private.source_snapshots enable row level security;
revoke all on career_private.source_snapshots from public,anon,authenticated;
grant select,insert,update on career_private.source_snapshots to service_role;

create function public.career_apply_source_snapshot(p_source text,p_observed_at timestamptz,p_rows jsonb,p_complete boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_now timestamptz:=clock_timestamp(); v_previous timestamptz; v_previous_hash text;
 v_rows jsonb; v_hash text; v_item jsonb; v_field text; v_action text;
 v_locked uuid[]; v_received integer; v_inserted integer:=0; v_refreshed integer:=0; v_pruned integer:=0;
begin
 if p_source is null or char_length(p_source) not between 1 and 140 or p_source !~ '^[A-Za-z0-9][A-Za-z0-9~_-]*$'
  or p_observed_at is null or not isfinite(p_observed_at) or p_observed_at<v_now-interval '24 hours'
  -- Observation clocks are distinct machines; this is a bounded skew guard,
  -- not permission to manufacture a provider run's future completion.
  or p_observed_at>v_now+interval '1 minute' or p_complete is null or (p_complete and p_source<>'curated')
  or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>1000 or pg_column_size(p_rows)>16777216 then
  raise exception 'career snapshot invalid';
 end if;
 v_received:=jsonb_array_length(p_rows);
 for v_item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(v_item) is distinct from 'object'
   or (select count(*) from jsonb_object_keys(v_item))<>12
   or exists(select 1 from jsonb_object_keys(v_item) k where k not in('external_id','title','company','url','location','role','remote','salary','tags','seniority','description','posted_at'))
   or jsonb_typeof(v_item->'external_id') is distinct from 'string' or char_length(v_item->>'external_id') not between 1 and 2048
   or jsonb_typeof(v_item->'title') is distinct from 'string' or char_length(v_item->>'title') not between 1 and 300 or btrim(v_item->>'title')=''
   or jsonb_typeof(v_item->'url') is distinct from 'string' or char_length(v_item->>'url') not between 1 and 2048 or (v_item->>'url') !~ '^https://'
   or jsonb_typeof(v_item->'role') is distinct from 'string' or (v_item->>'role') not in('frontend','fullstack','software')
   or jsonb_typeof(v_item->'remote') is distinct from 'boolean'
   or jsonb_typeof(v_item->'tags') is distinct from 'array' or jsonb_array_length(v_item->'tags')>50 then
   raise exception 'career snapshot invalid';
  end if;
  if exists(select 1 from jsonb_array_elements(v_item->'tags') tag where jsonb_typeof(tag) is distinct from 'string' or char_length(tag#>>'{}')>100) then raise exception 'career snapshot invalid'; end if;
  foreach v_field in array array['company','location','salary','seniority','description','posted_at'] loop
   if jsonb_typeof(v_item->v_field) is null or jsonb_typeof(v_item->v_field) not in('string','null') then raise exception 'career snapshot invalid'; end if;
   if char_length(v_item->>v_field)>(case when v_field='description' then 12000 when v_field='seniority' then 200 when v_field='posted_at' then 60 else 500 end) then raise exception 'career snapshot invalid'; end if;
  end loop;
  if v_item->>'posted_at' is not null and ((v_item->>'posted_at') !~ '^\d{4}-\d{2}-\d{2}T' or not isfinite((v_item->>'posted_at')::timestamptz)) then raise exception 'career snapshot invalid'; end if;
 end loop;
 if (select count(distinct value->>'external_id') from jsonb_array_elements(p_rows))<>v_received then raise exception 'career snapshot invalid'; end if;
 select coalesce(jsonb_agg(value order by value->>'external_id'),'[]'::jsonb) into v_rows from jsonb_array_elements(p_rows);
 v_hash:=encode(sha256(convert_to(v_rows::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('own-dashboard-career-listings',0));
 v_now:=clock_timestamp();
 if p_observed_at<v_now-interval '24 hours' or p_observed_at>v_now+interval '1 minute' then raise exception 'career snapshot invalid'; end if;
 select observed_at,snapshot_hash into v_previous,v_previous_hash from career_private.source_snapshots where source=p_source;
 if not found then
  -- Seed the first admission from existing history without rewriting it.
  select max(last_seen_at) into v_previous from public.job_listings where source=p_source;
 end if;
 if p_observed_at<v_previous then
  return jsonb_build_object('source',p_source,'observedAt',p_observed_at,'status','stale','received',v_received,'inserted',0,'refreshed',0,'pruned',0);
 end if;
 if p_observed_at=v_previous and v_previous_hash is not null then
  return jsonb_build_object('source',p_source,'observedAt',p_observed_at,'status',case when v_hash=v_previous_hash then 'duplicate' else 'conflict' end,'received',v_received,'inserted',0,'refreshed',0,'pruned',0);
 end if;
 -- PostgreSQL 17 returns actual MERGE actions. No capped preceding read or
 -- xmax heuristic is used to invent the inserted/refreshed split.
 for v_action in
  merge into public.job_listings target
  using jsonb_to_recordset(v_rows) as incoming(external_id text,title text,company text,url text,location text,role text,remote boolean,salary text,tags text[],seniority text,description text,posted_at timestamptz)
  on target.source=p_source and target.external_id=incoming.external_id
  when matched and target.last_seen_at<p_observed_at then update set
   title=incoming.title,company=incoming.company,url=incoming.url,location=incoming.location,role=incoming.role,remote=incoming.remote,salary=incoming.salary,tags=incoming.tags,seniority=incoming.seniority,description=incoming.description,posted_at=incoming.posted_at,last_seen_at=p_observed_at
  when not matched then insert(source,external_id,title,company,url,location,role,remote,salary,tags,seniority,description,posted_at,last_seen_at)
   values(p_source,incoming.external_id,incoming.title,incoming.company,incoming.url,incoming.location,incoming.role,incoming.remote,incoming.salary,incoming.tags,incoming.seniority,incoming.description,incoming.posted_at,p_observed_at)
  returning merge_action()
 loop
  if v_action='INSERT' then v_inserted:=v_inserted+1; elsif v_action='UPDATE' then v_refreshed:=v_refreshed+1; end if;
 end loop;
 -- Only the registered complete curated source can establish absence. An
 -- empty/filtered result never supplies closure proof. Newer rows survive.
 if p_complete and v_received>0 then
  select coalesce(array_agg(candidate.id),'{}'::uuid[]) into v_locked from (
   select j.id from public.job_listings j where j.source=p_source and j.last_seen_at<p_observed_at
    and not exists(select 1 from jsonb_array_elements(v_rows) r where r->>'external_id'=j.external_id)
    and not exists(select 1 from public.job_user_state u where u.listing_id=j.id and u.state='deleted')
   order by j.id limit 10000 for update of j skip locked
  ) candidate;
  with removed as(delete from public.job_listings j where j.id=any(v_locked) and j.source=p_source and j.last_seen_at<p_observed_at
   and not exists(select 1 from jsonb_array_elements(v_rows) r where r->>'external_id'=j.external_id)
   and not exists(select 1 from public.job_user_state u where u.listing_id=j.id and u.state='deleted') returning 1)
   select count(*) into v_pruned from removed;
 end if;
 insert into career_private.source_snapshots(source,observed_at,snapshot_hash,changed_at) values(p_source,p_observed_at,v_hash,clock_timestamp())
 on conflict(source) do update set observed_at=excluded.observed_at,snapshot_hash=excluded.snapshot_hash,changed_at=excluded.changed_at;
 return jsonb_build_object('source',p_source,'observedAt',p_observed_at,'status','applied','received',v_received,'inserted',v_inserted,'refreshed',v_refreshed,'pruned',v_pruned);
end $$;
revoke all on function public.career_apply_source_snapshot(text,timestamptz,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.career_apply_source_snapshot(text,timestamptz,jsonb,boolean) to service_role;

-- A read-only liveness/filter proof names the exact version inspected. A
-- refreshed/repointed listing cannot be deleted by an older asynchronous probe.
create function public.career_delete_listing_versions(p_rows jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare v_item jsonb; v_deleted integer; v_locked uuid[];
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>1000 or pg_column_size(p_rows)>1048576 then raise exception 'career removal invalid'; end if;
 for v_item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(v_item) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_item))<>4
   or jsonb_typeof(v_item->'id') is distinct from 'string' or (v_item->>'id')::uuid is null
   or jsonb_typeof(v_item->'source') is distinct from 'string' or char_length(v_item->>'source') not between 1 and 140
   or jsonb_typeof(v_item->'url') is distinct from 'string' or char_length(v_item->>'url') not between 1 and 2048
   or jsonb_typeof(v_item->'last_seen_at') is distinct from 'string' or not isfinite((v_item->>'last_seen_at')::timestamptz) then raise exception 'career removal invalid'; end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then raise exception 'career removal invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('own-dashboard-career-listings',0));
 select coalesce(array_agg(candidate.id),'{}'::uuid[]) into v_locked from (
  select j.id from public.job_listings j join jsonb_to_recordset(p_rows) r(id uuid,source text,url text,last_seen_at timestamptz)
   on j.id=r.id and j.source=r.source and j.url=r.url and j.last_seen_at=r.last_seen_at
  where not exists(select 1 from public.job_user_state u where u.listing_id=j.id and u.state='deleted')
  order by j.id for update of j skip locked
 ) candidate;
 with removed as(delete from public.job_listings j using jsonb_to_recordset(p_rows) r(id uuid,source text,url text,last_seen_at timestamptz)
  where j.id=any(v_locked) and j.id=r.id and j.source=r.source and j.url=r.url and j.last_seen_at=r.last_seen_at
  and not exists(select 1 from public.job_user_state u where u.listing_id=j.id and u.state='deleted') returning 1)
  select count(*) into v_deleted from removed;
 return v_deleted;
end $$;
revoke all on function public.career_delete_listing_versions(jsonb) from public,anon,authenticated;
grant execute on function public.career_delete_listing_versions(jsonb) to service_role;

-- Preserve the existing 45-day discovery-cache retention policy, returning an
-- aggregate receipt instead of a REST-capped deleted-row page. Each cleanup
-- window removes at most 10,000 proven candidates; locked rows stay for later.
create function public.career_prune_stale_listings(p_sources text[]) returns integer
language plpgsql security invoker set search_path='' as $$
declare v_deleted integer; v_locked uuid[]; v_cutoff timestamptz;
begin
 if p_sources is null or cardinality(p_sources) not between 1 and 30
  or exists(select 1 from unnest(p_sources) s where s is null or char_length(s) not between 1 and 140 or s !~ '^[A-Za-z0-9][A-Za-z0-9~_-]*$')
  or (select count(distinct s) from unnest(p_sources) s)<>cardinality(p_sources) then raise exception 'career retention invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('own-dashboard-career-listings',0));
 v_cutoff:=clock_timestamp()-interval '45 days';
 select coalesce(array_agg(candidate.id),'{}'::uuid[]) into v_locked from (
  select j.id from public.job_listings j where j.source=any(p_sources) and j.last_seen_at<v_cutoff
   and not exists(select 1 from public.job_user_state u where u.listing_id=j.id and u.state='deleted')
  order by j.last_seen_at,j.id limit 10000 for update of j skip locked
 ) candidate;
 with removed as(delete from public.job_listings j where j.id=any(v_locked) and j.source=any(p_sources) and j.last_seen_at<v_cutoff
  and not exists(select 1 from public.job_user_state u where u.listing_id=j.id and u.state='deleted') returning 1)
  select count(*) into v_deleted from removed;
 return v_deleted;
end $$;
revoke all on function public.career_prune_stale_listings(text[]) from public,anon,authenticated;
grant execute on function public.career_prune_stale_listings(text[]) to service_role;
