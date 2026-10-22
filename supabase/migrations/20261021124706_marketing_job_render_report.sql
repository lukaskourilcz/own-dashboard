-- A generated DNESKAi deck is rendered inside its job, so its render report used
-- to stay in the job result and never reached the revision: the review showed
-- the studio's advisories only after an owner edit. The finished job now stores
-- `result.renderReport` beside the revision it saves. Same body as
-- 20261012232949 otherwise; a job without a report (devShark, a legacy job)
-- leaves `render_report` null, as before. A report that does not have the
-- stored shape fails the column check and rolls the whole finish back.
create or replace function public.marketing_finish_job(p_owner uuid,p_job uuid,p_fence uuid,p_result jsonb,p_error text default null)
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
