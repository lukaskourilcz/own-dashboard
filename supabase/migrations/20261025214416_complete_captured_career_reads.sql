-- Prepared only. Complete captured Career reads; no private history rewrite.
-- Historical native remote booleans lack workplace evidence. Keep them stored
-- but do not promote them to fully remote eligibility until a new strict source
-- snapshot confirms the value. Non-native remote-only feeds keep their contract.
set lock_timeout='5s';
alter table public.job_listings add column native_remote_verified boolean not null default false;
comment on column public.job_listings.native_remote_verified is
 'Strict native workplace normalization applied by the service snapshot RPC; legacy booleans remain unverified.';
create or replace function public.career_apply_source_snapshot(p_source text,p_observed_at timestamptz,p_rows jsonb,p_complete boolean default false)
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
   title=incoming.title,company=incoming.company,url=incoming.url,location=incoming.location,role=incoming.role,remote=incoming.remote,salary=incoming.salary,tags=incoming.tags,seniority=incoming.seniority,description=incoming.description,posted_at=incoming.posted_at,last_seen_at=p_observed_at,native_remote_verified=(p_source ~ '^(ashby|lever|greenhouse)-')
  when not matched then insert(source,external_id,title,company,url,location,role,remote,salary,tags,seniority,description,posted_at,last_seen_at,native_remote_verified)
   values(p_source,incoming.external_id,incoming.title,incoming.company,incoming.url,incoming.location,incoming.role,incoming.remote,incoming.salary,incoming.tags,incoming.seniority,incoming.description,incoming.posted_at,p_observed_at,(p_source ~ '^(ashby|lever|greenhouse)-'))
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

-- Exact projections exclude future/unreviewed columns. One invoker statement
-- snapshot, original owner before empty/nonempty reads, no extra auth request.
create function public.read_career_records(p_entity text,p_expected_owner uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=(select auth.uid()); maximum integer:=10000; ordering text; projection text; rows jsonb; result jsonb;
begin
 if actor is null or p_expected_owner is null or p_expected_owner<>actor then raise exception 'Career owner unavailable' using errcode='42501'; end if;
 if p_entity='job_listings' then
  select coalesce(jsonb_agg(to_jsonb(j) order by j.first_seen_at desc,j.id desc),'[]'::jsonb) into rows from (
   select l.id,l.source,l.external_id,l.title,l.company,l.url,l.location,l.role,
    case when l.source ~ '^(ashby|lever|greenhouse)-' then l.remote and l.native_remote_verified else l.remote end as remote,
    l.salary,l.tags,l.seniority,l.description,l.posted_at,l.first_seen_at,l.last_seen_at
   from public.job_listings l
   where not exists(select 1 from public.job_user_state s where s.user_id=actor and s.listing_id=l.id and s.state='deleted')
   order by l.first_seen_at desc,l.id desc limit maximum+1
  ) j;
 elsif p_entity='job_scrape_runs' then
  maximum:=1;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc,r.id desc),'[]'::jsonb) into rows from (
   select id,started_at,finished_at,ok,inserted,refreshed,pruned,sources from public.job_scrape_runs order by started_at desc,id desc limit 1
  ) r;
 else
  case p_entity
   when 'job_user_state' then maximum:=20000; ordering:='created_at,id'; projection:='id,user_id,listing_id,state,created_at';
   when 'saved_job_positions' then ordering:='saved_at desc,id desc'; projection:='id,user_id,listing_id,title,company,url,source,location,description,cover_letter,notes,saved_at,updated_at,cover_letter_url,readiness';
   when 'job_applications' then ordering:='applied_on desc,created_at desc,id desc'; projection:='id,user_id,listing_id,title,company,url,source,location,cover_letter,status,applied_on,notes,created_at,updated_at,organization_id,next_follow_up_at,cover_letter_url,request_id,responded_on,response_kind,contact_name,contact_email';
   when 'job_application_events' then maximum:=50000; ordering:='created_at desc,id desc'; projection:='id,user_id,application_id,kind,detail,created_at';
   when 'cover_letter_templates' then ordering:='created_at,id'; projection:='id,user_id,name,body,created_at,updated_at';
   else raise exception 'Career collection unavailable' using errcode='22023';
  end case;
  execute format('select coalesce(jsonb_agg(to_jsonb(owned) order by %s),''[]''::jsonb) from (select %s from public.%I where user_id=$1 order by %s limit $2) owned',ordering,projection,p_entity,ordering)
   into rows using actor,maximum+1;
 end if;
 if jsonb_array_length(rows)>maximum then raise exception 'Career complete read exceeded' using errcode='54000'; end if;
 result:=jsonb_build_object('ownerId',actor,'collection',p_entity,'rows',rows);
 if octet_length(result::text)>10*1024*1024 then raise exception 'Career complete read exceeded' using errcode='54000'; end if;
 return result;
end $$;
revoke all on function public.read_career_records(text,uuid) from public,anon,service_role;
grant execute on function public.read_career_records(text,uuid) to authenticated;
comment on function public.read_career_records(text,uuid) is
 'Complete explicit Career projections with captured ownership, own-only private RLS and marker-aware public discovery; refuses row/10MiB overflow.';
reset lock_timeout;
