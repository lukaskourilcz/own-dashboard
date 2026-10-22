-- Prepared only; not applied. Owner decision 8 (22 October 2026), „Regenerate with a note“: the owner asks for a new
-- draft of a returned DNESKAi post (or one in review) and the job carries the replaced revision's id as
-- `generation.replacesRevisionId`. When that job finishes, the new revision replaces the old one through the existing
-- marketing_save_revision lineage (status superseded, a queued publication cancelled), so the Lab shows one post, not
-- two. The replaced version is superseded only while it is still `review` or `returned`: a version the owner approved
-- meanwhile keeps its approval and publication, and the new draft is saved beside it as before.
--
-- Same body as 20261021124706_marketing_job_render_report.sql otherwise: the calendar check, the fence, the render
-- report and the job status. The new revision is saved ready and in review; nothing here approves it.
-- The application sends `replacesRevisionId` only when the server-only DNESKAI_REGENERATE_ENABLED is "true", which the
-- owner sets after this migration is applied. Without the key the function behaves exactly as before.
create or replace function public.marketing_finish_job(p_owner uuid,p_job uuid,p_fence uuid,p_result jsonb,p_error text default null)
returns text language plpgsql set search_path='' as $$
declare j public.marketing_jobs; calendar_current boolean; v_replace uuid;
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
  -- A regeneration replaces its revision only while the owner has not decided otherwise: still in review or returned,
  -- owned, same brand, and not the revision being saved.
  if coalesce(j.request->'generation'->>'replacesRevisionId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   select r.id into v_replace from public.marketing_revisions r where r.id=(j.request->'generation'->>'replacesRevisionId')::uuid and r.user_id=p_owner
    and r.brand=p_result->'revision'->>'brand' and r.status in ('review','returned') and r.id<>(j.request->'generation'->>'revisionId')::uuid
    and not exists(select 1 from public.marketing_publications p where p.revision_id=r.id and p.status in ('claimed','published','reconciliation'));
  end if;
  perform public.marketing_save_revision(p_owner,(j.request->'generation'->>'revisionId')::uuid,p_result->'revision',p_result->>'revisionHash',true,p_result->'slides',v_replace);
  if j.request->>'calendarEntryId' is not null then update public.marketing_revisions r set campaign_id=e.campaign_id,calendar_entry_id=e.id
   from public.marketing_calendar_entries e where r.id=(j.request->'generation'->>'revisionId')::uuid and r.user_id=p_owner and e.id=(j.request->>'calendarEntryId')::uuid and e.user_id=p_owner; end if;
  if p_result ? 'renderReport' then
   update public.marketing_revisions set render_report=p_result->'renderReport'
    where id=(j.request->'generation'->>'revisionId')::uuid and user_id=p_owner;
  end if;
 end if;
 update public.marketing_jobs set status=case when p_error is null then 'review' else 'failed' end,
 result=p_result,error_code=left(p_error,100),lease_until=null where id=j.id;
 return case when p_error is null then 'review' else 'failed' end;
end $$;
revoke all on function public.marketing_finish_job(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_finish_job(uuid,uuid,uuid,jsonb,text) to service_role;
