-- Preserve explicit workplace evidence in private Career snapshots. Null means
-- unknown; existing history is not inferred from a later public listing.
set lock_timeout='5s';
alter table public.saved_job_positions add column remote boolean;
alter table public.job_applications add column remote boolean;
comment on column public.saved_job_positions.remote is 'Remote workplace evidence at capture; null preserves unknown legacy/manual evidence.';
comment on column public.job_applications.remote is 'Remote workplace evidence at application capture; null means unknown, not onsite.';

create or replace function public.record_job_application(p_request_id uuid, p_saved_id uuid, p_payload jsonb)
returns public.job_applications language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved public.saved_job_positions;
  result public.job_applications;
  sent_on date := (p_payload->>'applied_on')::date;
begin
  if actor is null or p_request_id is null then raise exception 'Authentication and request ID required' using errcode='42501'; end if;
  if p_saved_id is not null and p_request_id <> p_saved_id then raise exception 'Saved request ID mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || p_request_id::text,0));
  select * into result from public.job_applications where user_id=actor and request_id=p_request_id;
  if found then return result; end if;
  if p_saved_id is not null then
    select * into saved from public.saved_job_positions where id=p_saved_id and user_id=actor for update;
    if not found then raise exception 'Saved position not found' using errcode='P0002'; end if;
  end if;
  if p_payload ? 'remote' and jsonb_typeof(p_payload->'remote') not in ('boolean','null') then raise exception 'Invalid remote evidence' using errcode='22023'; end if;
  if length(btrim(coalesce(p_payload->>'title',''))) not between 1 and 200 then raise exception 'Position required'; end if;
  if sent_on is null or sent_on > public.current_owner_day() then raise exception 'Invalid application date'; end if;
  if nullif(p_payload->>'url','') is not null and p_payload->>'url' !~ '^https?://[^/[:space:]]+' then raise exception 'Invalid posting URL'; end if;
  insert into public.job_applications(user_id,listing_id,title,company,url,source,location,remote,cover_letter,cover_letter_url,notes,applied_on,request_id)
  values(actor,case when p_saved_id is not null then saved.listing_id else nullif(p_payload->>'listing_id','')::uuid end,
    btrim(p_payload->>'title'),nullif(btrim(p_payload->>'company'),''),nullif(p_payload->>'url',''),
    coalesce(saved.source,p_payload->>'source'),coalesce(saved.location,p_payload->>'location'),
    case when p_saved_id is not null then saved.remote else (p_payload->>'remote')::boolean end,
    coalesce(p_payload->>'cover_letter',saved.cover_letter,''),nullif(p_payload->>'cover_letter_url',''),
    nullif(p_payload->>'notes',''),sent_on,p_request_id) returning * into result;
  insert into public.job_application_events(user_id,application_id,kind,detail) values(actor,result.id,'applied',sent_on::text);
  if p_saved_id is not null then delete from public.saved_job_positions where id=p_saved_id and user_id=actor; end if;
  return result;
end $$;
revoke all on function public.record_job_application(uuid,uuid,jsonb) from public,anon;
grant execute on function public.record_job_application(uuid,uuid,jsonb) to authenticated;


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
   when 'job_user_state' then maximum:=20000; ordering:='created_at,id'; projection:='id,user_id,listing_id,state,created_at';
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
