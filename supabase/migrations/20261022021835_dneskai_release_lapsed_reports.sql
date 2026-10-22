-- Prepared only. No historic rows change on migration; this replaces the future skip path.
create or replace function public.marketing_dneskai_skip_brief(p_owner uuid,p_brief uuid,p_code text,p_duplicate_of text default null) returns jsonb language plpgsql set search_path='' as $$
declare b public.marketing_dneskai_briefs;
begin
 select * into b from public.marketing_dneskai_briefs where id=p_brief and user_id=p_owner for update;
 if not found then raise exception 'brief unavailable';end if;
 if b.status='skipped' then return to_jsonb(b);end if;
 if b.status not in('pending','ready') then raise exception 'brief closed';end if;
 if coalesce(p_code,'') !~ '^[a-z0-9-]{1,64}$' or length(p_duplicate_of)>200 then raise exception 'brief state invalid';end if;
 -- Serialize with enqueue's source SHARE lock before checking durable jobs.
 perform 1 from public.marketing_sources s where s.user_id=p_owner and s.brand='dneskai' and s.source_id=b.event_id
  and s.packet->'brief'->>'targetDate'=b.target_date::text for update;
 if p_duplicate_of is not null then
  update public.marketing_dneskai_candidates set status='duplicate',target_date=null,updated_at=clock_timestamp(),
   candidate=jsonb_set(jsonb_set(jsonb_set(jsonb_set(candidate,'{status}','"duplicate"'),'{targetDate}','null'),'{duplicateOf}',to_jsonb(p_duplicate_of)),'{reason}','"collection-already-covered"')
   where user_id=p_owner and project_id=b.project_id and id=any(b.member_ids) and status='selected' and target_date=b.target_date;
 end if;
 -- A lapsed selection is not coverage. Release only never-generated reports, with no other active brief.
 -- Keep jobs and revisions as evidence even if a foreign key was cleared or a job failed after starting.
 if p_duplicate_of is null and b.job_id is null
  and ((p_code='brief-slot-passed' and b.scheduled_at<clock_timestamp()+interval '30 minutes')
    or (p_code='brief-expired' and (b.brief->>'expiresAt')::timestamptz<=clock_timestamp())
    or (p_code='brief-target-date-passed' and b.target_date<=(clock_timestamp() at time zone 'Europe/Prague')::date))
  and not exists(select 1 from public.marketing_jobs j where j.user_id=p_owner
    and (j.request->>'calendarEntryId'=b.calendar_entry_id::text
      or (j.request->'generation'->'source'->>'brand'='dneskai' and j.request->'generation'->'source'->>'sourceId'=b.event_id)))
  and not exists(select 1 from public.marketing_revisions v where v.user_id=p_owner and v.brand='dneskai'
    and (v.calendar_entry_id=b.calendar_entry_id or exists(select 1 from jsonb_array_elements(v.revision->'sources') ref where ref->>'sourceId'=b.event_id))) then
  -- An ingested but unused source head must no longer admit a job after its brief is skipped.
  update public.marketing_sources s set eligible=false,packet=s.packet||jsonb_build_object('eligible',false,'eligibilityReason',p_code)
   where s.user_id=p_owner and s.brand='dneskai' and s.source_id=b.event_id and s.packet->'brief'->>'targetDate'=b.target_date::text;
  update public.marketing_dneskai_candidates c set status='new',target_date=null,updated_at=clock_timestamp(),
   candidate=c.candidate||jsonb_build_object('status','new','targetDate',null,'reason',null,'duplicateOf',null)
   where c.user_id=p_owner and c.project_id=b.project_id and c.id=any(b.member_ids) and c.status='selected' and c.target_date=b.target_date
    and not exists(select 1 from public.marketing_dneskai_briefs other where other.user_id=p_owner and other.project_id=b.project_id
      and other.id<>b.id and other.status<>'skipped' and c.id=any(other.member_ids));
 end if;
 update public.marketing_dneskai_briefs set status='skipped',code=p_code,updated_at=clock_timestamp() where id=b.id returning * into b;
 return to_jsonb(b);
end $$;
