create table public.marketing_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 idempotency_key uuid not null, request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'), request jsonb not null,
 status text not null default 'queued' check(status in ('queued','running','review','failed','reconciliation')),
 fence uuid, lease_until timestamptz, result jsonb, error_code text, created_at timestamptz not null default now(),
 unique(user_id,idempotency_key)
);
alter table public.marketing_jobs enable row level security;
revoke all on public.marketing_jobs from anon,authenticated;
grant select on public.marketing_jobs to authenticated;
grant all on public.marketing_jobs to service_role;
create policy owner_read on public.marketing_jobs for select to authenticated using ((select auth.uid())=user_id);
create index marketing_jobs_pending on public.marketing_jobs(user_id,created_at) where status='queued';
create unique index marketing_one_active_campaign on public.marketing_campaigns(user_id,brand) where status='active';
create function public.marketing_activate_campaign(p_campaign uuid,p_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare c public.marketing_campaigns;
begin
 perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text||'marketing-campaign',0));
 select * into c from public.marketing_campaigns where id=p_campaign and user_id=(select auth.uid()) for update;
 if not found or c.source_hash<>p_hash then raise exception 'campaign changed'; end if;
 -- Archival gates queued workers, approvals and both remote write intents.
 -- Do not rewrite publication receipts or acquire revision/publication locks
 -- here: their state remains available for read-only remote reconciliation.
 update public.marketing_campaigns set status='archived' where user_id=c.user_id and brand=c.brand and id<>c.id and status<>'archived';
 update public.marketing_campaigns set status='active' where id=c.id;
end $$;
revoke all on function public.marketing_activate_campaign(uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_activate_campaign(uuid,text) to authenticated;
create function public.marketing_release_calendar_entry(p_entry uuid,p_hash text,p_source uuid,p_date date,p_time text,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare e public.marketing_calendar_entries; c public.marketing_campaigns;
begin
 select * into e from public.marketing_calendar_entries where id=p_entry and user_id=(select auth.uid()) for update;
 if not found then raise exception 'entry unavailable'; end if;
 select * into c from public.marketing_campaigns where id=e.campaign_id and user_id=e.user_id;
 if not found or c.source_hash<>p_hash or c.status='archived' or p_date<c.starts_on or p_date>c.ends_on then raise exception 'campaign changed'; end if;
 if (e.platform='instagram' and p_kind<>'carousel') or (e.platform='threads' and p_kind<>'thread') or e.platform not in ('instagram','threads')
  or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or e.status in ('published','done') then raise exception 'entry not releasable'; end if;
 if not exists(select 1 from public.marketing_sources s where s.id=p_source and s.user_id=e.user_id and s.brand=c.brand and s.eligible and (s.expires_at is null or s.expires_at>now())) then raise exception 'current source required'; end if;
 if exists(select 1 from public.marketing_jobs j join public.marketing_publications p on p.revision_id=(j.request->'generation'->>'revisionId')::uuid
   where j.user_id=e.user_id and j.request->>'calendarEntryId'=e.id::text and p.status in ('claimed','reconciliation','published')) then raise exception 'entry publication already started'; end if;
 update public.marketing_publications set status='cancelled' where user_id=e.user_id and status='queued' and revision_id in(
  select (request->'generation'->>'revisionId')::uuid from public.marketing_jobs where user_id=e.user_id and request->>'calendarEntryId'=e.id::text);
 update public.marketing_revisions set status='superseded',approved_hash=null,approved_at=null where user_id=e.user_id and status in ('review','approved','returned','failed') and id in(
  select (request->'generation'->>'revisionId')::uuid from public.marketing_jobs where user_id=e.user_id and request->>'calendarEntryId'=e.id::text);
 update public.marketing_jobs set status=case when status='running' then 'reconciliation' else 'failed' end,error_code='calendar-entry-rebound',fence=null,lease_until=null where user_id=e.user_id and request->>'calendarEntryId'=e.id::text and status in ('queued','running');
 update public.marketing_calendar_entries set date=p_date,local_time=p_time,kind=p_kind,bound_source_id=p_source,status='planned',needs_review=false,generation_version=generation_version+1 where id=e.id;
end $$;
revoke all on function public.marketing_release_calendar_entry(uuid,text,uuid,date,text,text) from public,anon,authenticated;
grant execute on function public.marketing_release_calendar_entry(uuid,text,uuid,date,text,text) to authenticated;

-- All calendar workers lock entry -> campaign -> source before the job row.
-- Release locks the entry first too, so a delayed pre-release snapshot cannot
-- slip in after the cancellation transaction or create a lock-order cycle.
create function public.marketing_calendar_job_current(p_owner uuid,p_request jsonb)
returns boolean language plpgsql set search_path='' as $$
declare e public.marketing_calendar_entries; c public.marketing_campaigns; s public.marketing_sources;
begin
 if p_request->>'calendarEntryId' is null then return p_request->>'calendarEntryVersion' is null; end if;
 if p_request->>'calendarEntryVersion' is null or p_request->>'calendarEntryVersion' !~ '^[1-9][0-9]{0,8}$' then return false; end if;
 select * into e from public.marketing_calendar_entries where id=(p_request->>'calendarEntryId')::uuid and user_id=p_owner for update;
 if not found or e.generation_version is distinct from (p_request->>'calendarEntryVersion')::integer
  or e.status<>'planned' or e.needs_review or e.platform is distinct from p_request->'generation'->'account'->>'platform' then return false; end if;
 select * into c from public.marketing_campaigns where id=e.campaign_id and user_id=p_owner for share;
 if not found or c.status<>'active' or c.brand is distinct from p_request->'generation'->'source'->>'brand'
  or c.time_zone<>'Europe/Prague' or e.date<c.starts_on or e.date>c.ends_on
  or coalesce(e.local_time,'09:00') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  or ((e.date::text||' '||coalesce(e.local_time,'09:00'))::timestamp at time zone c.time_zone)
   is distinct from (p_request->'generation'->>'scheduledAt')::timestamptz then return false; end if;
 select * into s from public.marketing_sources where user_id=p_owner and brand=c.brand
  and source_id=p_request->'generation'->'source'->>'sourceId' for share;
 if not found or not s.eligible or (s.expires_at is not null and s.expires_at<=now())
  or s.source_revision is distinct from p_request->'generation'->'source'->>'sourceRevision'
  or s.content_hash is distinct from p_request->'generation'->'source'->>'contentHash'
  or (e.bound_source_id is not null and e.bound_source_id<>s.id) then return false; end if;
 return true;
end $$;
revoke all on function public.marketing_calendar_job_current(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_calendar_job_current(uuid,jsonb) to service_role;

create function public.marketing_enqueue_job(p_owner uuid,p_key uuid,p_hash text,p_request jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare j public.marketing_jobs; duplicate boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'marketing-job-budget',0));
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_key::text,0));
 select * into j from public.marketing_jobs where user_id=p_owner and idempotency_key=p_key;
 duplicate:=found;
 if duplicate then
  if j.request_hash<>p_hash then raise exception 'job identity conflict'; end if;
  return jsonb_build_object('jobId',j.id,'status',j.status,'duplicate',true);
 end if;
 if not public.marketing_calendar_job_current(p_owner,p_request) then raise exception 'calendar entry unavailable'; end if;
 if not duplicate then
 if (select count(*) from public.marketing_jobs where user_id=p_owner and created_at>now()-interval '24 hours')>=8 then raise exception 'daily job budget exhausted'; end if;
 insert into public.marketing_jobs(user_id,idempotency_key,request_hash,request)
 values(p_owner,p_key,p_hash,p_request) returning * into j; end if;
 return jsonb_build_object('jobId',j.id,'status',j.status,'duplicate',duplicate);
end $$;
create function public.marketing_claim_job(p_owner uuid,p_job uuid,p_fence uuid)
returns jsonb language plpgsql set search_path='' as $$
declare j public.marketing_jobs; calendar_current boolean;
begin
 if p_fence is null then raise exception 'job fence required'; end if;
 select * into j from public.marketing_jobs where id=p_job and user_id=p_owner;
 if not found then raise exception 'job unavailable'; end if;
 calendar_current:=public.marketing_calendar_job_current(p_owner,j.request);
 select * into j from public.marketing_jobs where id=p_job and user_id=p_owner for update;
 if j.status='running' and j.lease_until<now() then
  update public.marketing_jobs set status='reconciliation',error_code='worker-lease-expired' where id=j.id;
  return null;
 end if;
 if j.status<>'queued' then return null; end if;
 if not calendar_current then
  update public.marketing_jobs set status='failed',error_code='calendar-entry-changed',fence=null,lease_until=null where id=j.id;
  return null;
 end if;
 update public.marketing_jobs set status='running',fence=p_fence,lease_until=now()+interval '2 minutes' where id=j.id;
 return j.request;
end $$;
create function public.marketing_finish_job(p_owner uuid,p_job uuid,p_fence uuid,p_result jsonb,p_error text default null)
returns text language plpgsql set search_path='' as $$
declare j public.marketing_jobs; calendar_current boolean;
begin
 select * into j from public.marketing_jobs where id=p_job and user_id=p_owner;
 if not found then raise exception 'job fence lost'; end if;
 calendar_current:=public.marketing_calendar_job_current(p_owner,j.request);
 select * into j from public.marketing_jobs where id=p_job and user_id=p_owner for update;
 if not found or j.status<>'running' or j.fence is distinct from p_fence or j.lease_until is null or j.lease_until<=now() then raise exception 'job fence lost'; end if;
 if not calendar_current then
  update public.marketing_jobs set status='reconciliation',error_code='calendar-entry-changed',fence=null,lease_until=null where id=j.id;
  return 'reconciliation';
 end if;
 if p_error is null then
  perform public.marketing_save_revision(p_owner,(j.request->'generation'->>'revisionId')::uuid,p_result->'revision',p_result->>'revisionHash',true,p_result->'slides',null);
  if j.request->>'calendarEntryId' is not null then update public.marketing_revisions r set campaign_id=e.campaign_id
   from public.marketing_calendar_entries e where r.id=(j.request->'generation'->>'revisionId')::uuid and r.user_id=p_owner and e.id=(j.request->>'calendarEntryId')::uuid and e.user_id=p_owner; end if;
 end if;
 update public.marketing_jobs set status=case when p_error is null then 'review' else 'failed' end,
 result=p_result,error_code=left(p_error,100),lease_until=null where id=j.id;
 return case when p_error is null then 'review' else 'failed' end;
end $$;

-- Receipt and revision transition commit together. An ambiguous send is never requeued.
create function public.marketing_record_receipt(p_owner uuid,p_publication uuid,p_status text,p_container text,p_media text,p_url text,p_error text)
returns text language plpgsql set search_path='' as $$
declare p public.marketing_publications;
begin
 if p_status not in ('published','failed','reconciliation') then raise exception 'invalid receipt'; end if;
 select * into p from public.marketing_publications where id=p_publication and user_id=p_owner for update;
 if not found then raise exception 'publication unavailable'; end if;
 if p.status='published' then
  if p_status<>'published' or p.remote_media_id is distinct from p_media then raise exception 'receipt conflict'; end if;
  return p.status;
 end if;
 if p.status not in ('claimed','reconciliation') then raise exception 'publication not claimed'; end if;
 if p_status='published' and (p_media is null or p_url is null or p_url !~ '^https://') then raise exception 'missing receipt'; end if;
 update public.marketing_publications set status=p_status,remote_container_id=p_container,remote_media_id=p_media,remote_url=p_url,error_code=p_error,lease_until=null where id=p.id;
 update public.marketing_revisions set status=p_status where id=p.revision_id and user_id=p_owner;
 insert into public.marketing_events(user_id,revision_id,kind,payload) values(p_owner,p.revision_id,p_status,jsonb_build_object('publicationId',p.id));
 return p_status;
end $$;

create function public.marketing_checkpoint_publication(p_owner uuid,p_publication uuid,p_expected_container text,p_expected_error text,p_container text,p_error text)
returns void language plpgsql set search_path='' as $$
declare p public.marketing_publications; r public.marketing_revisions; expected_campaign uuid; expected_revision uuid;
begin
 select * into p from public.marketing_publications where id=p_publication and user_id=p_owner;
 if not found then raise exception 'publication fence lost'; end if;
 expected_revision:=p.revision_id;
 select campaign_id into expected_campaign from public.marketing_revisions where id=expected_revision and user_id=p_owner;
 if p_error in ('container-create-intent','publish-intent') and not public.marketing_revision_campaign_active(p_owner,expected_campaign)
 then raise exception 'publication no longer authorized'; end if;
 select * into p from public.marketing_publications where id=p_publication and user_id=p_owner for update;
 if not found or p.revision_id is distinct from expected_revision or p.status<>'claimed' or p.lease_until<=now()
  or p.remote_container_id is distinct from p_expected_container or p.error_code is distinct from p_expected_error
 then raise exception 'publication fence lost'; end if;
 select * into r from public.marketing_revisions where id=p.revision_id and user_id=p_owner for update;
 if p_error in ('container-create-intent','publish-intent') and (not found or r.campaign_id is distinct from expected_campaign or r.status not in ('approved','publishing') or not r.ready or r.approved_hash is distinct from r.content_hash
  or not public.marketing_sources_valid(p_owner,r.brand,r.revision,now(),true)
  or p.scheduled_at<now()-interval '15 minutes' or p.scheduled_at>now()
  or not exists(select 1 from public.marketing_accounts a where a.user_id=p_owner and a.brand=r.brand and a.platform=p.platform
   and a.remote_account_id=r.revision->'account'->>'id' and a.handle=r.revision->'account'->>'handle' and a.verified_at is not null and a.enabled)
 ) then raise exception 'publication no longer authorized'; end if;
 update public.marketing_publications set remote_container_id=p_container,error_code=p_error where id=p.id;
 update public.marketing_revisions set status='publishing' where id=p.revision_id and user_id=p_owner and status='approved';
end $$;
create function public.marketing_finish_publication(p_owner uuid,p_publication uuid,p_expected_container text,p_expected_error text,p_status text,p_container text,p_media text,p_url text,p_error text)
returns text language plpgsql set search_path='' as $$
declare p public.marketing_publications;
begin
 select * into p from public.marketing_publications where id=p_publication and user_id=p_owner for update;
 if not found or p.remote_container_id is distinct from p_expected_container or p.error_code is distinct from p_expected_error
 then raise exception 'publication fence lost'; end if;
 return public.marketing_record_receipt(p_owner,p_publication,p_status,p_container,p_media,p_url,p_error);
end $$;

revoke all on function public.marketing_enqueue_job(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_enqueue_job(uuid,uuid,text,jsonb) to service_role;
revoke all on function public.marketing_claim_job(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_claim_job(uuid,uuid,uuid) to service_role;
revoke all on function public.marketing_finish_job(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_finish_job(uuid,uuid,uuid,jsonb,text) to service_role;
revoke all on function public.marketing_record_receipt(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.marketing_record_receipt(uuid,uuid,text,text,text,text,text) to service_role;
revoke all on function public.marketing_checkpoint_publication(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.marketing_checkpoint_publication(uuid,uuid,text,text,text,text) to service_role;
revoke all on function public.marketing_finish_publication(uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.marketing_finish_publication(uuid,uuid,text,text,text,text,text,text,text) to service_role;
