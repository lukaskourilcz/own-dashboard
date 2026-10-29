-- Capture exact Calendar entry intent without storing another column or nonce.
-- This pure hash helper reads no table and grants no access to another owner.
create function public.marketing_calendar_entry_capture(p_id uuid,p_owner uuid,p_campaign uuid,p_original_source text,p_bound_source uuid,p_date date,p_time text,p_kind text,p_platform text,p_title text,p_status text,p_review boolean,p_generation integer)
returns text language sql immutable security invoker set search_path='' as $function$
 select encode(extensions.digest(convert_to(jsonb_build_array('marketing-calendar-entry/1',p_id,p_owner,p_campaign,p_original_source,p_bound_source,p_date,p_time,p_kind,p_platform,p_title,p_status,p_review,p_generation)::text,'UTF8'),'sha256'),'hex');
$function$;
revoke all on function public.marketing_calendar_entry_capture(uuid,uuid,uuid,text,uuid,date,text,text,text,text,text,boolean,integer) from public,anon,service_role;
grant execute on function public.marketing_calendar_entry_capture(uuid,uuid,uuid,text,uuid,date,text,text,text,text,text,boolean,integer) to authenticated;

-- Existing approval/worker/replacement paths take entry -> campaign first too.
-- The legacy void RPC remains available; new API callers use this captured read/write receipt.
create function public.marketing_release_calendar_entry_captured(
 p_entry uuid,p_entry_hash text,p_campaign_hash text,p_source uuid,p_source_hash text,p_source_revision text,
 p_date date,p_time text,p_kind text,p_when timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare
 owner_id uuid:=auth.uid(); e public.marketing_calendar_entries; c public.marketing_campaigns; s public.marketing_sources;
 previous_hash text; original_entry public.marketing_calendar_entries; local_stamp timestamp; revision_ids uuid[]; changed_revision_ids uuid[]; actual_revision_ids uuid[]; expected_revisions jsonb; expected_publications jsonb; expected_jobs jsonb; actual jsonb;
begin
 if owner_id is null then raise exception 'calendar owner unavailable'; end if;
 if p_entry_hash is null or p_entry_hash!~'^[a-f0-9]{64}$' or p_campaign_hash is null or p_campaign_hash!~'^[a-f0-9]{64}$'
  or p_source_hash is null or p_source_hash!~'^[a-f0-9]{64}$' or p_source_revision is null or length(p_source_revision) not between 1 and 200
  or p_date is null or not isfinite(p_date) or p_time is null or p_time!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
  or p_kind is null or p_kind not in ('carousel','thread') or p_when is null or not isfinite(p_when)
 then raise exception 'invalid calendar intent'; end if;
 select * into e from public.marketing_calendar_entries where id=p_entry and user_id=owner_id for update;
 if not found then raise exception 'calendar entry changed'; end if;
 original_entry:=e;
 previous_hash:=public.marketing_calendar_entry_capture(e.id,e.user_id,e.campaign_id,e.source_id,e.bound_source_id,e.date,e.local_time,e.kind,e.platform,e.title,e.status,e.needs_review,e.generation_version);
 if previous_hash is distinct from p_entry_hash or e.generation_version<1 or e.status in ('published','done','archived')
  or e.kind not in ('post','carousel','thread') or e.platform not in ('instagram','threads')
  or (e.platform='instagram' and p_kind<>'carousel') or (e.platform='threads' and p_kind<>'thread')
 then raise exception 'calendar entry changed'; end if;
 select * into c from public.marketing_campaigns where id=e.campaign_id and user_id=owner_id for share;
 if not found or c.source_hash is distinct from p_campaign_hash or c.status='archived' or p_date<c.starts_on or p_date>c.ends_on
 then raise exception 'calendar campaign changed'; end if;
 select * into s from public.marketing_sources where id=p_source and user_id=owner_id and brand=c.brand for share;
 if not found or not s.eligible or s.content_hash is distinct from p_source_hash or s.source_revision is distinct from p_source_revision
  or s.packet->>'brand' is distinct from s.brand or s.packet->>'sourceId' is distinct from s.source_id
  or s.packet->>'contentHash' is distinct from s.content_hash or s.packet->>'sourceRevision' is distinct from s.source_revision
  or s.packet->>'eligible' is distinct from 'true'
  or (s.expires_at is not null and s.expires_at<=clock_timestamp())
  or (s.packet->>'expiresAt' is not null and (s.packet->>'expiresAt')::timestamptz<=clock_timestamp())
 then raise exception 'calendar source changed'; end if;
 local_stamp:=p_date+p_time::time;
 if p_when<=clock_timestamp() or p_when at time zone 'Europe/Prague' is distinct from local_stamp
  or (p_when-interval '1 hour') at time zone 'Europe/Prague'=local_stamp
 then raise exception 'calendar schedule changed'; end if;
 select coalesce(array_agg(target.id order by target.id),'{}'::uuid[]) into revision_ids from (select r.id from public.marketing_revisions r where r.user_id=owner_id and (r.calendar_entry_id=p_entry or exists(select 1 from public.marketing_jobs j where j.user_id=owner_id and j.request->>'calendarEntryId'=p_entry::text and j.request->'generation'->>'revisionId'=r.id::text)) order by r.id limit 1001) target;
 if cardinality(revision_ids)>1000 then raise exception 'calendar history too large'; end if;
 select coalesce(array_agg(r.id order by r.id),'{}'::uuid[]) into changed_revision_ids from public.marketing_revisions r where r.id=any(revision_ids) and r.status in ('review','approved','returned','failed');
 if exists(select 1 from public.marketing_revisions r where r.id=any(revision_ids) and
  (r.status in ('publishing','published','reconciliation') or (r.campaign_id is not null and r.campaign_id<>e.campaign_id)
   or (r.calendar_entry_id is not null and r.calendar_entry_id<>e.id)))
  or exists(select 1 from public.marketing_publications p where p.user_id=owner_id and p.revision_id=any(revision_ids) and p.status in ('claimed','published','reconciliation'))
 then raise exception 'calendar publication started'; end if;
 select coalesce(jsonb_agg(jsonb_build_array(r.id,r.user_id,r.campaign_id,r.calendar_entry_id,r.content_hash,
  case when r.status in ('review','approved','returned','failed') then 'superseded' else r.status end,
  case when r.status in ('review','approved','returned','failed') then null else r.approved_hash end,
  case when r.status in ('review','approved','returned','failed') then null else r.approved_at end) order by r.id),'[]')
 into expected_revisions from public.marketing_revisions r where r.id=any(changed_revision_ids);
 select coalesce(jsonb_agg(jsonb_build_array(p.id,p.user_id,p.revision_id,case when p.status='queued' then 'cancelled' else p.status end,
  p.remote_container_id,p.remote_media_id,p.remote_url,p.error_code) order by p.id),'[]') into expected_publications
 from (select id,user_id,revision_id,status,remote_container_id,remote_media_id,remote_url,error_code from public.marketing_publications where user_id=owner_id and revision_id=any(revision_ids) and status='queued' order by id limit 1001) p;
 select coalesce(jsonb_agg(jsonb_build_array(j.id,j.user_id,j.idempotency_key,j.request_hash,
  case when j.status='running' then 'reconciliation' when j.status='queued' then 'failed' else j.status end,
  case when j.status in ('running','queued') then 'calendar-entry-rebound' else j.error_code end,
  case when j.status in ('running','queued') then null else j.fence end,
  case when j.status in ('running','queued') then null else j.lease_until end) order by j.id),'[]') into expected_jobs
 from (select id,user_id,idempotency_key,request_hash,status,error_code,fence,lease_until from public.marketing_jobs where user_id=owner_id and request->>'calendarEntryId'=p_entry::text and status in ('queued','running') order by id limit 1001) j;
 if jsonb_array_length(expected_publications)>1000 or jsonb_array_length(expected_jobs)>1000 then raise exception 'calendar history too large'; end if;
 perform public.marketing_release_calendar_entry(p_entry,p_campaign_hash,p_source,p_date,p_time,p_kind);
 select * into e from public.marketing_calendar_entries where id=p_entry and user_id=owner_id;
 if not found or e.campaign_id is distinct from c.id or e.date is distinct from p_date or e.local_time is distinct from p_time
  or e.kind is distinct from p_kind or e.bound_source_id is distinct from p_source or e.status<>'planned' or e.needs_review
  or e.source_id is distinct from original_entry.source_id or e.title is distinct from original_entry.title or e.platform is distinct from original_entry.platform
  or e.generation_version is distinct from original_entry.generation_version+1
 then raise exception 'calendar release unconfirmed'; end if;
 -- Check the intended entry fields against the original captured row, not only a changed hash.
 -- The row is already locked; subsequent legitimate entry work cannot overtake this transaction.
 select coalesce(jsonb_agg(jsonb_build_array(r.id,r.user_id,r.campaign_id,r.calendar_entry_id,r.content_hash,r.status,r.approved_hash,r.approved_at) order by r.id),'[]')
 into actual from public.marketing_revisions r where r.id=any(changed_revision_ids);
 if actual is distinct from expected_revisions then raise exception 'calendar revision unconfirmed'; end if;
 select coalesce(jsonb_agg(jsonb_build_array(p.id,p.user_id,p.revision_id,p.status,p.remote_container_id,p.remote_media_id,p.remote_url,p.error_code) order by p.id),'[]')
 into actual from public.marketing_publications p where p.id in (select (value->>0)::uuid from jsonb_array_elements(expected_publications));
 if actual is distinct from expected_publications then raise exception 'calendar publication unconfirmed'; end if;
 select coalesce(jsonb_agg(jsonb_build_array(j.id,j.user_id,j.idempotency_key,j.request_hash,j.status,j.error_code,j.fence,j.lease_until) order by j.id),'[]')
 into actual from public.marketing_jobs j where j.id in (select (value->>0)::uuid from jsonb_array_elements(expected_jobs));
 if actual is distinct from expected_jobs then raise exception 'calendar jobs unconfirmed'; end if;
 select coalesce(array_agg(target.id order by target.id),'{}'::uuid[]) into actual_revision_ids from (select r.id from public.marketing_revisions r where r.user_id=owner_id and (r.calendar_entry_id=p_entry or exists(select 1 from public.marketing_jobs j where j.user_id=owner_id and j.request->>'calendarEntryId'=p_entry::text and j.request->'generation'->>'revisionId'=r.id::text)) order by r.id limit 1001) target;
 if actual_revision_ids is distinct from revision_ids or exists(select 1 from public.marketing_publications where user_id=owner_id and revision_id=any(revision_ids) and status in ('queued','claimed','published','reconciliation')) or exists(select 1 from public.marketing_jobs where user_id=owner_id and request->>'calendarEntryId'=p_entry::text and status in ('queued','running')) then raise exception 'calendar related work changed'; end if;
 if p_when<=clock_timestamp() or not exists(select 1 from public.marketing_campaigns check_c where check_c.id=c.id and check_c.user_id=c.user_id
  and check_c.brand=c.brand and check_c.source_hash=c.source_hash and check_c.status=c.status and check_c.starts_on=c.starts_on and check_c.ends_on=c.ends_on and check_c.time_zone=c.time_zone)
  or not exists(select 1 from public.marketing_sources check_s where check_s.id=s.id and check_s.user_id=owner_id and check_s.brand=c.brand
   and check_s.source_id=s.source_id and check_s.content_hash=p_source_hash and check_s.source_revision=p_source_revision and check_s.eligible
   and check_s.packet->>'brand'=check_s.brand and check_s.packet->>'sourceId'=check_s.source_id
   and check_s.packet->>'contentHash'=p_source_hash and check_s.packet->>'sourceRevision'=p_source_revision
   and check_s.packet->>'eligible'='true' and (check_s.expires_at is null or check_s.expires_at>clock_timestamp())
   and (check_s.packet->>'expiresAt' is null or (check_s.packet->>'expiresAt')::timestamptz>clock_timestamp()))
 then raise exception 'calendar source or schedule changed'; end if;
 return jsonb_build_object('ownerId',owner_id,'previousHash',previous_hash,'source',jsonb_build_object('id',s.id,'sourceRevision',s.source_revision,'contentHash',s.content_hash),
  'entry',jsonb_build_object('id',e.id,'campaign_id',e.campaign_id,'date',e.date,'local_time',e.local_time,'bound_source_id',e.bound_source_id,
   'title',e.title,'kind',e.kind,'platform',e.platform,'status',e.status,'needs_review',e.needs_review,'capture_hash',public.marketing_calendar_entry_capture(e.id,e.user_id,e.campaign_id,e.source_id,e.bound_source_id,e.date,e.local_time,e.kind,e.platform,e.title,e.status,e.needs_review,e.generation_version)));
end;
$function$;
revoke all on function public.marketing_release_calendar_entry_captured(uuid,text,text,uuid,text,text,date,text,text,timestamptz) from public,anon,service_role;
grant execute on function public.marketing_release_calendar_entry_captured(uuid,text,text,uuid,text,text,date,text,text,timestamptz) to authenticated;

create or replace function public.marketing_workspace_snapshot() returns jsonb
language sql stable security invoker set search_path = ''
as $function$
with owner_scope as materialized (select auth.uid() as user_id),
campaigns as materialized (
  select c.id,c.user_id,c.brand,c.name,c.starts_on,c.ends_on,c.source_hash,c.status,c.created_at
  from public.marketing_campaigns c join owner_scope o on c.user_id=o.user_id
  where c.status <> 'archived'
  order by (c.status='active') desc,c.starts_on desc,c.created_at desc,c.id limit 10
),
entries as materialized (
  select e.user_id,e.id,e.campaign_id,e.date,e.local_time,e.bound_source_id,e.title,e.kind,e.platform,e.status,e.needs_review,public.marketing_calendar_entry_capture(e.id,e.user_id,e.campaign_id,e.source_id,e.bound_source_id,e.date,e.local_time,e.kind,e.platform,e.title,e.status,e.needs_review,e.generation_version) as capture_hash
  from public.marketing_calendar_entries e join campaigns c on c.id=e.campaign_id and c.user_id=e.user_id
  order by e.date,e.local_time nulls last,e.id limit 10001
),
revisions as materialized (
  select r.id, r.user_id, r.project_id, r.campaign_id, r.revision, r.content_hash, r.ready, r.status, r.approved_at, r.approved_hash, r.feedback, r.created_at, r.render_report, r.offline_import_receipt
  from public.marketing_revisions r join owner_scope o on r.user_id=o.user_id
  order by r.created_at desc,r.id limit 100
),
publications as materialized (
  select p.id, p.user_id, p.revision_id, p.platform, p.status, p.remote_container_id, p.remote_media_id, p.remote_url, p.error_code, p.created_at
  from public.marketing_publications p join owner_scope o on p.user_id=o.user_id
  order by p.created_at desc,p.id limit 100
),
accounts as materialized (
  select a.user_id, a.brand, a.platform, a.remote_account_id, a.handle, a.enabled, a.verified_at
  from public.marketing_accounts a join owner_scope o on a.user_id=o.user_id
  order by a.brand,a.platform,a.id limit 4
),
jobs as materialized (
  select j.user_id, j.id, j.status, j.error_code, j.created_at, j.request->'generation'->'source'->>'brand' as brand, j.result->'usage'->>'estimatedCostUsd' as cost_usd
  from public.marketing_jobs j join owner_scope o on j.user_id=o.user_id
  order by j.created_at desc,j.id limit 100
),
events as materialized (
  select e.user_id, e.revision_id, e.kind, e.created_at, e.id
  from public.marketing_events e join owner_scope o on e.user_id=o.user_id
  where e.kind in ('approved','returned','skipped')
  order by e.created_at desc,e.id limit 100
),
sources as materialized (
  select s.user_id,s.id,s.brand,s.source_id,s.source_revision,s.content_hash,s.eligible,s.observed_at,
    s.packet->>'brand' as summary_brand, s.packet->>'sourceId' as summary_source_id,
    s.packet->>'sourceRevision' as summary_revision, s.packet->>'contentHash' as summary_hash,
    s.packet->>'canonicalUrl' as summary_url, s.packet->>'expiresAt' as summary_expires,
    s.packet->'content'->>'title' as summary_title, s.packet->'content'->'evidence' as summary_evidence
  from public.marketing_sources s join owner_scope o on s.user_id=o.user_id
  order by s.observed_at desc,s.id limit 100
),
source_history as materialized (
  select s.user_id,s.id,s.recorded_at,s.packet->>'brand' as summary_brand, s.packet->>'sourceId' as summary_source_id,
    s.packet->>'sourceRevision' as summary_revision, s.packet->>'contentHash' as summary_hash,
    s.packet->>'canonicalUrl' as summary_url, s.packet->>'expiresAt' as summary_expires,
    s.packet->'content'->>'title' as summary_title, s.packet->'content'->'evidence' as summary_evidence
  from public.marketing_source_history s join owner_scope o on s.user_id=o.user_id
  order by s.recorded_at desc,s.id limit 200
)
select jsonb_build_object(
  'ownerId',(select user_id from owner_scope),
  'entriesComplete',(select count(*)<=10000 from entries),
  'revisions',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id),'[]'::jsonb) from revisions r),
  'campaigns',(select coalesce(jsonb_agg(to_jsonb(c)-'created_at' order by (c.status='active') desc,c.starts_on desc,c.created_at desc,c.id),'[]'::jsonb) from campaigns c),
  'entries',(select coalesce(jsonb_agg(to_jsonb(e) order by e.date,e.local_time nulls last,e.id),'[]'::jsonb) from (select user_id,id,campaign_id,date,local_time,bound_source_id,title,kind,platform,status,needs_review,capture_hash from entries order by date,local_time nulls last,id limit 10000) e),
  'publications',(select coalesce(jsonb_agg(to_jsonb(p)-'created_at' order by p.created_at desc,p.id),'[]'::jsonb) from publications p),
  'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.brand,a.platform),'[]'::jsonb) from accounts a),
  'sources',(select coalesce(jsonb_agg(to_jsonb(s)-'observed_at' order by s.observed_at desc,s.id),'[]'::jsonb) from sources s),
  'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc,j.id),'[]'::jsonb) from jobs j),
  'events',(select coalesce(jsonb_agg(to_jsonb(e)-'id' order by e.created_at desc,e.id),'[]'::jsonb) from events e),
  'sourceHistory',(select coalesce(jsonb_agg(to_jsonb(s)-'id'-'recorded_at' order by s.recorded_at desc,s.id),'[]'::jsonb) from source_history s)
);
$function$;
revoke all on function public.marketing_workspace_snapshot() from public,anon,service_role;
grant execute on function public.marketing_workspace_snapshot() to authenticated;
comment on function public.marketing_workspace_snapshot() is 'Read-only own-RLS workspace snapshot; active heads first, recent samples and complete selected-head entries up to 10000.';
