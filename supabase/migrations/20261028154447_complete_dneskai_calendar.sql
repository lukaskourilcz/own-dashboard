-- A complete seven-day owner snapshot, independent of review/history pages.
create function public.read_owned_dneskai_calendar(p_owner uuid,p_project uuid,p_date date,p_now timestamptz,p_topic_titles boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare first_at timestamptz;last_at timestamptz;revisions jsonb;jobs jsonb;revision_count integer;job_count integer;brief_count integer;briefs jsonb;unreadable integer;result jsonb;
begin
 if current_user<>'authenticated' or p_owner is null or auth.uid() is distinct from p_owner
  or not exists(select 1 from public.projects p where p.id=p_project and p.user_id=p_owner)
 then raise exception 'Calendar unavailable' using errcode='42501';end if;
 if p_date is null or p_now is null or not isfinite(p_date) or not isfinite(p_now)
  or p_date<(p_now at time zone 'Europe/Prague')::date-7 or p_date>(p_now at time zone 'Europe/Prague')::date+7
 then raise exception 'Calendar invalid' using errcode='22023';end if;
 first_at:=p_date::timestamp at time zone 'Europe/Prague';last_at:=(p_date+7)::timestamp at time zone 'Europe/Prague';
 with revision_context as not materialized (
  select r.id,r.replaces_id,r.status,r.ready,r.content_hash,r.created_at,r.approved_at,r.feedback,r.revision,r.render_report,
   case when p.id is not null then p.scheduled_at
    when (r.revision->>'scheduledAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' and pg_input_is_valid(r.revision->>'scheduledAt','timestamptz') then (r.revision->>'scheduledAt')::timestamptz end as at,
   case when p.id is null then null else jsonb_build_object('id',p.id,'revision_id',p.revision_id,'status',p.status,
    'scheduled_at',p.scheduled_at,'remote_url',p.remote_url,'error_code',p.error_code,'last_checked_at',p.last_checked_at) end as publication,
   case when p_topic_titles then (
    select t.title_cs from public.marketing_dneskai_briefs b join public.marketing_dneskai_topics t on t.brief_id=b.id and t.user_id=b.user_id
    where b.user_id=p_owner and b.event_id=r.revision->'sources'->0->>'sourceId' and b.member_hash=r.revision->'sources'->0->>'sourceRevision'
     and b.status<>'skipped' and t.status in('enriching','briefed','generated')
    order by t.updated_at desc,t.id desc limit 1) end as topic_title
  from public.marketing_revisions r left join public.marketing_publications p on p.user_id=r.user_id and p.revision_id=r.id
   and p.platform=r.revision->'account'->>'platform' and p.status<>'cancelled'
  where r.user_id=p_owner and r.brand='dneskai' and r.status not in('superseded','skipped')
 ),job_context as not materialized (
  select j.id,j.status,j.error_code,j.created_at,j.request->'generation'->'source'->'content'->>'title' as title,
   j.request->'generation'->>'revisionId' as revision_id,
   case when (j.request->'generation'->>'scheduledAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' and pg_input_is_valid(j.request->'generation'->>'scheduledAt','timestamptz') then (j.request->'generation'->>'scheduledAt')::timestamptz end as at,
   case when p_topic_titles then (select t.title_cs from public.marketing_dneskai_topics t where t.user_id=p_owner
    and t.brief_id is not null and t.evidence->>'jobId'=j.id::text and t.status in('enriching','briefed','generated')
    order by t.updated_at desc,t.id desc limit 1) end as topic_title
  from public.marketing_jobs j where j.user_id=p_owner and j.request->'generation'->'source'->>'brand'='dneskai'
   and j.status in('queued','running','failed','reconciliation')
 ),brief_context as not materialized (
  select b.id,b.status,b.code,b.scheduled_at as at,b.brief->>'title' as title,
   case when p_topic_titles then (select t.title_cs from public.marketing_dneskai_topics t where t.user_id=p_owner and t.brief_id=b.id
    and t.status in('enriching','briefed','generated') order by t.updated_at desc,t.id desc limit 1) end as topic_title
  from public.marketing_dneskai_briefs b where b.user_id=p_owner and b.project_id=p_project and b.status in('pending','ready')
   and b.job_id is null and b.scheduled_at is not null
 ),window_briefs as materialized(select *,count(*) over() as total_count from brief_context where at>=first_at and at<last_at limit 251),
 window_revisions as materialized(select *,count(*) over() as total_count from revision_context where at>=first_at and at<last_at limit 251),
 window_jobs as materialized(select *,count(*) over() as total_count from job_context j where at>=first_at and at<last_at
  and not exists(select 1 from window_revisions r where r.id::text=j.revision_id) limit 251)
 select (select coalesce(max(total_count),0) from window_revisions),(select coalesce(max(total_count),0) from window_jobs),(select coalesce(max(total_count),0) from window_briefs),
  (select count(*) from revision_context where at is null or not isfinite(at))+(select count(*) from job_context where at is null or not isfinite(at))+(select count(*) from brief_context where not isfinite(at)),
  (select coalesce(jsonb_agg(jsonb_build_object('id',id,'replaces_id',replaces_id,'status',status,'ready',ready,'content_hash',content_hash,
   'created_at',created_at,'approved_at',approved_at,'feedback',feedback,'revision',revision,'render_report',render_report,
   'publication',publication,'topic_title',topic_title) order by at,id) filter(where total_count<=250),'[]'::jsonb) from window_revisions),
  (select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'error_code',error_code,'created_at',created_at,
   'title',title,'scheduled_at',at,'topic_title',topic_title) order by at,id) filter(where total_count<=250),'[]'::jsonb) from window_jobs),
  (select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'code',code,'scheduled_at',at,'title',title,'topic_title',topic_title) order by at,id) filter(where total_count<=250),'[]'::jsonb) from window_briefs)
 into revision_count,job_count,brief_count,unreadable,revisions,jobs,briefs;
 result:=jsonb_build_object('ownerId',p_owner,'projectId',p_project,'date',p_date,'asOf',p_now,'revisionCount',revision_count,
  'jobCount',job_count,'briefCount',brief_count,'unreadable',unreadable,'revisions',revisions,'jobs',jobs,'briefs',briefs);
 if revision_count+job_count+brief_count>250 or octet_length(result::text)>8388608 then raise exception 'Calendar unavailable' using errcode='54000';end if;
 return result;
end $$;
revoke all on function public.read_owned_dneskai_calendar(uuid,uuid,date,timestamptz,boolean) from public,anon,authenticated,service_role;
grant execute on function public.read_owned_dneskai_calendar(uuid,uuid,date,timestamptz,boolean) to authenticated;
comment on function public.read_owned_dneskai_calendar(uuid,uuid,date,timestamptz,boolean) is
 'One stable own-RLS seven-day snapshot before REST row caps. Complete scheduled revisions/jobs/waiting briefs ignore creation age and review cursors; 250 records/8MiB maximum, unknown dates counted. No credentials, row/policy/table-grant changes.';
