-- A stale clear-shortlist action must not erase a newer permanent deletion marker.
set lock_timeout='5s';
alter table public.job_user_state add column updated_at timestamptz;
-- Set the default separately: existing triage history remains null/unknown.
alter table public.job_user_state alter column updated_at set default clock_timestamp();
alter table public.job_user_state add constraint job_user_state_finite_versions
 check(isfinite(created_at) and (updated_at is null or isfinite(updated_at))) not valid;
alter table public.job_user_state validate constraint job_user_state_finite_versions;
create trigger career_private_version_touch before update on public.job_user_state
 for each row execute function public.career_private_version_touch();


-- Older browser tabs still have table write grants. Protect the durable marker
-- there too, while retaining the existing Auth-owner deletion cascade. Only a
-- nested FK operation with permission to inspect Auth can establish that its
-- owner has actually gone; ordinary API writes never query Auth records.
create function public.career_triage_permanent_intent() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.state='deleted' then
  if tg_op='DELETE' then
   if pg_trigger_depth()>1 and has_table_privilege(current_user,'auth.users','select') then
    if not exists(select 1 from auth.users where id=old.user_id) then return old; end if;
   end if;
   raise exception 'Career triage changed' using errcode='P0002';
  elsif (new.id,new.user_id,new.listing_id,new.state,new.created_at) is distinct from
        (old.id,old.user_id,old.listing_id,old.state,old.created_at) then
   raise exception 'Career triage changed' using errcode='P0002';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.career_triage_permanent_intent() from public,anon,authenticated,service_role;
create trigger career_triage_permanent_intent before update or delete on public.job_user_state
 for each row execute function public.career_triage_permanent_intent();

create function public.apply_career_triage(p_expected_owner uuid,p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare actor uuid:=(select auth.uid()); item jsonb; expected jsonb; desired text; current_row public.job_user_state;
 v_listing_id uuid; v_row_id uuid; source_url text; source_seen timestamptz; receipts jsonb[]:=array[]::jsonb[]; result jsonb;
begin
 if actor is null or p_expected_owner is null or actor<>p_expected_owner then raise exception 'Career owner unavailable' using errcode='42501'; end if;
 if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 1000
  or octet_length(p_changes::text)>10*1024*1024 then raise exception 'Career triage unavailable' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_changes) loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>6
   or exists(select 1 from jsonb_object_keys(item) k where k not in('id','listingId','url','lastSeenAt','next','expected'))
   or jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'listingId') is distinct from 'string'
   or jsonb_typeof(item->'url') is distinct from 'string' or length(item->>'url') not between 1 and 2048
   or item->>'url' !~ '^https://[^/[:space:]]+' or jsonb_typeof(item->'lastSeenAt') is distinct from 'string'
   or not isfinite((item->>'lastSeenAt')::timestamptz)
   or jsonb_typeof(item->'next') is null or jsonb_typeof(item->'next') not in('string','null')
   or (item->>'next' is not null and item->>'next' not in('shortlisted','deleted'))
   or jsonb_typeof(item->'expected') is null or jsonb_typeof(item->'expected') not in('object','null') then
   raise exception 'Career triage unavailable' using errcode='22023';
  end if;
  perform (item->>'id')::uuid,(item->>'listingId')::uuid;
  expected:=item->'expected';
  if expected<>'null'::jsonb then
   if (select count(*) from jsonb_object_keys(expected))<>4
    or exists(select 1 from jsonb_object_keys(expected) k where k not in('id','state','createdAt','updatedAt'))
    or jsonb_typeof(expected->'id') is distinct from 'string' or jsonb_typeof(expected->'state') is distinct from 'string'
    or expected->>'state' not in('shortlisted','deleted') or jsonb_typeof(expected->'createdAt') is distinct from 'string'
    or not isfinite((expected->>'createdAt')::timestamptz)
    or jsonb_typeof(expected->'updatedAt') is null or jsonb_typeof(expected->'updatedAt') not in('string','null')
    or (expected->>'updatedAt' is not null and not isfinite((expected->>'updatedAt')::timestamptz)) then
    raise exception 'Career triage unavailable' using errcode='22023';
   end if;
   perform (expected->>'id')::uuid;
  elsif item->>'next' is null then raise exception 'Career triage unavailable' using errcode='22023';
  end if;
 end loop;
 if (select count(distinct value->>'listingId') from jsonb_array_elements(p_changes))<>jsonb_array_length(p_changes)
  or (select count(distinct value->>'id') from jsonb_array_elements(p_changes))<>jsonb_array_length(p_changes) then
  raise exception 'Career triage unavailable' using errcode='22023';
 end if;
 -- Match discovery capture's short owner guard, then the shared source guard.
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':career-capture',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('own-dashboard-career-listings',0));
 for item in select value from jsonb_array_elements(p_changes) order by value->>'listingId' loop
  v_listing_id:=(item->>'listingId')::uuid;v_row_id:=(item->>'id')::uuid;desired:=item->>'next';expected:=item->'expected';
  source_url:=item->>'url';source_seen:=(item->>'lastSeenAt')::timestamptz;
  select * into current_row from public.job_user_state s where s.user_id=actor and s.listing_id=v_listing_id for update;
  if current_row.id is not null and current_row.state=desired then
   null; -- Desired state already confirmed; preserve its current identity/version.
  elsif current_row.id is not null then
   if current_row.state='deleted' or expected='null'::jsonb
    or current_row.id is distinct from (expected->>'id')::uuid or current_row.state is distinct from expected->>'state'
    or current_row.created_at is distinct from (expected->>'createdAt')::timestamptz
    or current_row.updated_at is distinct from (expected->>'updatedAt')::timestamptz then
    raise exception 'Career triage changed' using errcode='P0002';
   end if;
   if desired is null then
    delete from public.job_user_state s where s.user_id=actor and s.id=current_row.id;
    current_row:=null; -- Confirmed absent, never permission to clear a deleted marker.
   else
    perform 1 from public.job_listings l where l.id=v_listing_id and l.url=source_url and l.last_seen_at=source_seen;
    if not found then raise exception 'Career triage changed' using errcode='P0002'; end if;
    update public.job_user_state s set state=desired where s.user_id=actor and s.id=current_row.id returning s.* into current_row;
   end if;
  elsif desired is not null then
   if expected<>'null'::jsonb then raise exception 'Career triage changed' using errcode='P0002'; end if;
   perform 1 from public.job_listings l where l.id=v_listing_id and l.url=source_url and l.last_seen_at=source_seen;
   if not found then raise exception 'Career triage changed' using errcode='P0002'; end if;
   insert into public.job_user_state(id,user_id,listing_id,state) values(v_row_id,actor,v_listing_id,desired)
    on conflict(user_id,listing_id) do nothing returning * into current_row;
   if not found then
    select * into current_row from public.job_user_state s where s.user_id=actor and s.listing_id=v_listing_id for update;
    if not found or current_row.state is distinct from desired then raise exception 'Career triage changed' using errcode='P0002'; end if;
   end if;
  end if;
  receipts:=array_append(receipts,jsonb_build_object('listingId',v_listing_id,'next',desired,'row',
   case when current_row.id is null then null else jsonb_build_object('id',current_row.id,'user_id',current_row.user_id,'listing_id',current_row.listing_id,
    'state',current_row.state,'created_at',current_row.created_at,'updated_at',current_row.updated_at) end));
 end loop;
 result:=jsonb_build_object('ownerId',actor,'changes',receipts);
 if octet_length(result::text)>10*1024*1024 then raise exception 'Career triage exceeded' using errcode='54000'; end if;
 return result;
end $$;
revoke all on function public.apply_career_triage(uuid,jsonb) from public,anon,service_role;
grant execute on function public.apply_career_triage(uuid,jsonb) to authenticated;
comment on function public.apply_career_triage(uuid,jsonb) is
 'Captured owner/source/version triage; atomic <=1000 changes, current desired states are preserved and permanent deletion intent is never cleared.';

create or replace function public.read_career_records(p_entity text,p_expected_owner uuid) returns jsonb
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
   when 'job_user_state' then maximum:=20000; ordering:='created_at,id'; projection:='id,user_id,listing_id,state,created_at,updated_at';
   when 'saved_job_positions' then ordering:='saved_at desc,id desc'; projection:='id,user_id,listing_id,title,company,url,source,location,remote,description,cover_letter,notes,saved_at,updated_at,cover_letter_url,readiness';
   when 'job_applications' then ordering:='applied_on desc,created_at desc,id desc'; projection:='id,user_id,listing_id,title,company,url,source,location,remote,cover_letter,status,applied_on,notes,created_at,updated_at,organization_id,next_follow_up_at,cover_letter_url,request_id,responded_on,response_kind,contact_name,contact_email';
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
