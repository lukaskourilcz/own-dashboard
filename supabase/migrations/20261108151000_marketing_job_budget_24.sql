-- The owner asked on 8 November 2026 to regenerate 17 DNESKAi posts in the new house style within a day, next to the
-- night's own jobs. Eight jobs per rolling 24 hours cannot carry that; the cap rises to 24. The paid-call ceiling
-- (MARKETING_DNESKAI_DAILY_GENERATION_USD, reserved per job before every call) still bounds what the jobs may spend.
create or replace function marketing_private.marketing_enqueue_job(p_owner uuid, p_key uuid, p_hash text, p_request jsonb)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
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
 if (select count(*) from public.marketing_jobs where user_id=p_owner and created_at>now()-interval '24 hours')>=24 then raise exception 'daily job budget exhausted'; end if;
 insert into public.marketing_jobs(user_id,idempotency_key,request_hash,request)
 values(p_owner,p_key,p_hash,p_request) returning * into j; end if;
 return jsonb_build_object('jobId',j.id,'status',j.status,'duplicate',duplicate);
end $function$;
