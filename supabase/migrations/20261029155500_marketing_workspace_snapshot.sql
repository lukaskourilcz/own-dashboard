-- One authenticated, own-RLS statement snapshot for the Marketing workspace.
-- Recent lists remain bounded samples. Entries are complete for the selected
-- ten heads, or entriesComplete=false makes the API refuse the snapshot.
-- No table, index, write grant or private full-source body is added.
create function public.marketing_workspace_snapshot() returns jsonb
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
  select e.user_id,e.id,e.campaign_id,e.date,e.local_time,e.bound_source_id,e.title,e.kind,e.platform,e.status,e.needs_review
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
  'entries',(select coalesce(jsonb_agg(to_jsonb(e) order by e.date,e.local_time nulls last,e.id),'[]'::jsonb) from (select user_id,id,campaign_id,date,local_time,bound_source_id,title,kind,platform,status,needs_review from entries order by date,local_time nulls last,id limit 10000) e),
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
