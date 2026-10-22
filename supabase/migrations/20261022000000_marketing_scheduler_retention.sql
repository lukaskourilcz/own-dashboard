-- Scheduler retention (#120). These two objects belong to the scheduler release but never reached
-- production: the tool that applied 20261021124400–20261021124628 holds every statement that deletes
-- rows for a confirmation. Until this runs, the daily tick records an error for its retention step and
-- marketing_ticks and cron.job_run_details keep every row. Both statements are safe to run again.
--
-- marketing_scheduler_prune_ticks: the daily tick removes marketing_ticks rows older than p_days (14).
create or replace function public.marketing_scheduler_prune_ticks(p_owner uuid,p_days integer) returns integer
language plpgsql set search_path='' as $$
declare removed integer;
begin
 if p_owner is null or p_days is null or p_days not between 1 and 365 then raise exception 'tick retention invalid'; end if;
 delete from public.marketing_ticks where user_id=p_owner and started_at<clock_timestamp()-make_interval(days=>p_days);
 get diagnostics removed=row_count;
 return removed;
end $$;
revoke all on function public.marketing_scheduler_prune_ticks(uuid,integer) from public,anon,authenticated;
grant execute on function public.marketing_scheduler_prune_ticks(uuid,integer) to service_role;

-- marketing-cron-history-prune at 03:43 UTC deletes cron.job_run_details rows older than 14 days.
-- Supabase runs pg_cron with cron.log_run on and nothing else prunes that table, so the 289 runs a
-- day would otherwise stay forever. It deletes only the history of the two tick jobs, itself and jobs
-- that no longer exist (a tick job that was unscheduled and scheduled again gets a new jobid); any
-- other job, an unnamed one (cron.schedule without a name stores jobname null) included, keeps its
-- history. cron.schedule replaces a job of the same name, so re-running this block is safe.
do $schedule$
begin
 if to_regnamespace('cron') is not null then
  perform cron.schedule('marketing-cron-history-prune','43 3 * * *',$command$delete from cron.job_run_details where end_time < now() - interval '14 days' and jobid not in (select jobid from cron.job where coalesce(jobname,'') not in ('marketing-tick-minute','marketing-tick-daily','marketing-cron-history-prune'))$command$);
 end if;
end $schedule$;
