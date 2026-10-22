-- Prepared only; not applied. briefs-07 `release`: the owner releases the reports of a brief that lapsed before
-- 20261022021835 took effect (or under a protection that has since cleared), with the same conditions as that
-- migration's lapse path. Requires 20261022021835_dneskai_release_lapsed_reports.sql: it refuses to apply without it.
-- The application calls it only when the server-only DNESKAI_LAPSED_RELEASE_ENABLED is "true".
-- Releasing is not selection and not approval: the reports become open (status new) and a later nightly selection
-- may pick them within its usual freshness window. Jobs, revisions and other active briefs keep their reports.
do $$
begin
 if position('A lapsed selection is not coverage' in pg_get_functiondef('public.marketing_dneskai_skip_brief(uuid,uuid,text,text)'::regprocedure))=0 then
  raise exception 'apply 20261022021835_dneskai_release_lapsed_reports.sql first';
 end if;
end $$;

create function public.marketing_dneskai_release_brief(p_brief uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid());b public.marketing_dneskai_briefs;released integer;
begin
 if v_owner is null then raise exception 'brief unavailable';end if;
 select * into b from public.marketing_dneskai_briefs where id=p_brief and user_id=v_owner for update;
 if not found then raise exception 'brief unavailable';end if;
 if b.status<>'skipped' or coalesce(b.code,'') not in('brief-slot-passed','brief-target-date-passed','brief-slot-unavailable','brief-expired') then raise exception 'brief not releasable';end if;
 -- Serialize with enqueue's source SHARE lock before checking durable jobs, as the skip path does.
 perform 1 from public.marketing_sources s where s.user_id=v_owner and s.brand='dneskai' and s.source_id=b.event_id
  and s.packet->'brief'->>'targetDate'=b.target_date::text for update;
 if b.job_id is not null
  or exists(select 1 from public.marketing_jobs j where j.user_id=v_owner
    and (j.request->>'calendarEntryId'=b.calendar_entry_id::text
      or (j.request->'generation'->'source'->>'brand'='dneskai' and j.request->'generation'->'source'->>'sourceId'=b.event_id)))
  or exists(select 1 from public.marketing_revisions v where v.user_id=v_owner and v.brand='dneskai'
    and (v.calendar_entry_id=b.calendar_entry_id or exists(select 1 from jsonb_array_elements(v.revision->'sources') ref where ref->>'sourceId'=b.event_id))) then
  raise exception 'brief admitted';
 end if;
 -- An ingested but unused source head must no longer admit a job.
 update public.marketing_sources s set eligible=false,packet=s.packet||jsonb_build_object('eligible',false,'eligibilityReason',b.code)
  where s.user_id=v_owner and s.brand='dneskai' and s.source_id=b.event_id and s.packet->'brief'->>'targetDate'=b.target_date::text;
 update public.marketing_dneskai_candidates c set status='new',target_date=null,updated_at=clock_timestamp(),
  candidate=c.candidate||jsonb_build_object('status','new','targetDate',null,'reason',null,'duplicateOf',null)
  where c.user_id=v_owner and c.project_id=b.project_id and c.id=any(b.member_ids) and c.status='selected' and c.target_date=b.target_date
   and not exists(select 1 from public.marketing_dneskai_briefs other where other.user_id=v_owner and other.project_id=b.project_id
     and other.id<>b.id and other.status<>'skipped' and c.id=any(other.member_ids));
 get diagnostics released=row_count;
 if released=0 then raise exception 'brief nothing to release';end if;
 return jsonb_build_object('id',b.id,'released',released);
end $$;
revoke all on function public.marketing_dneskai_release_brief(uuid) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_release_brief(uuid) to authenticated;
