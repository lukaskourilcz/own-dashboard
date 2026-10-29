-- Complete totals stay in Postgres; the browser receives seven daily rows and twenty meaningful ticks.
set lock_timeout='5s';
create index marketing_jobs_dneskai_recent on public.marketing_jobs(user_id,created_at desc,id desc)
 where request->'generation'->'source'->>'brand'='dneskai';

create function public.marketing_dneskai_cost_totals(p_project uuid,p_days integer,p_now timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 owner_id uuid:=(select auth.uid());
 today date;
 first_day date;
 first_instant timestamptz;
 last_instant timestamptz;
 daily jsonb;
 tick_summary jsonb;
begin
 if owner_id is null or not exists(select 1 from public.projects p where p.id=p_project and p.user_id=owner_id) then
  raise exception 'project unavailable' using errcode='42501';
 end if;
 if p_days is null or p_days not between 1 and 7 or p_now is null or not isfinite(p_now)
  or p_now<'0001-01-02T00:00:00Z'::timestamptz or p_now>='9999-12-30T00:00:00Z'::timestamptz then
  raise exception 'invalid cost range' using errcode='22023';
 end if;
 today:=(p_now at time zone 'Europe/Prague')::date;
 first_day:=today+1-p_days;
 first_instant:=first_day::timestamp at time zone 'Europe/Prague';
 last_instant:=(today+1)::timestamp at time zone 'Europe/Prague';
 with run_values as (
  select r.date,case when r.status<>'running' and r.cost_usd between 0 and 10000 then r.cost_usd end as cost
  from public.marketing_dneskai_runs r where r.user_id=owner_id and r.project_id=p_project and r.date between first_day and today and r.created_at<=p_now
 ), run_totals as (
  select date,coalesce(sum(cost),0) as measured,count(*) filter(where cost is null) as unknown from run_values group by date
 ), job_values as (
  select (j.created_at at time zone 'Europe/Prague')::date as date,j.status,
   case when length(j.result->'usage'->>'estimatedCostUsd')<=128 and j.result->'usage'->>'estimatedCostUsd' ~ '^\d+(\.\d+)?$'
    then case when (j.result->'usage'->>'estimatedCostUsd')::numeric between 0 and 10000 then (j.result->'usage'->>'estimatedCostUsd')::numeric end
   end as cost
  from public.marketing_jobs j where j.user_id=owner_id and j.request->'generation'->'source'->>'brand'='dneskai'
   and j.created_at>=first_instant and j.created_at<last_instant and j.created_at<=p_now and j.status<>'queued'
 ), job_totals as (
  select date,coalesce(sum(cost) filter(where status='review'),0) as measured,
   coalesce(sum(cost) filter(where status<>'review'),0) as booked,count(*) filter(where cost is null) as unknown
  from job_values group by date
 )
 select jsonb_agg(jsonb_build_object('date',d.date,'collectionUsd',coalesce(r.measured,0),'generationUsd',coalesce(j.measured,0),
  'generationBookedUsd',coalesce(j.booked,0),'unknown',coalesce(r.unknown,0)+coalesce(j.unknown,0)) order by d.date desc)
 into daily from (select today-n as date from generate_series(0,p_days-1) n) d
 left join run_totals r using(date) left join job_totals j using(date);

 with tick_window as materialized (
  select t.id,t.kind,t.started_at,t.finished_at,t.did,t.errors,
   exists(select 1 from jsonb_array_elements(t.did) step where step->>'category'='generation' and step->>'status'='deferred') as deferred,
   jsonb_array_length(t.errors)>0 or exists(select 1 from jsonb_array_elements(t.did) step where step->>'status' in ('done','error')
    or (step->>'category'='generation' and step->>'status'='deferred')) as meaningful
  from public.marketing_ticks t where t.user_id=owner_id and t.started_at>=p_now-interval '24 hours' and t.started_at<=p_now
 ), recent as (
  select id,kind,started_at,finished_at,did,errors from tick_window where meaningful order by started_at desc,id desc limit 20
 )
 select jsonb_build_object('total',count(*),'withErrors',count(*) filter(where jsonb_array_length(errors)>0),
  'generationDeferred',count(*) filter(where deferred),'meaningfulCount',count(*) filter(where meaningful),'lastStartedAt',max(started_at),
  'recent',coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc,r.id desc) from recent r),'[]'::jsonb))
 into tick_summary from tick_window;
 return jsonb_build_object('ownerId',owner_id,'projectId',p_project,'dayCount',p_days,'asOf',p_now,'days',daily,'ticks',tick_summary);
end $$;
revoke all on function public.marketing_dneskai_cost_totals(uuid,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.marketing_dneskai_cost_totals(uuid,integer,timestamptz) to authenticated;
comment on function public.marketing_dneskai_cost_totals(uuid,integer,timestamptz) is
 'Own-only invoker/RLS cost and tick totals. No row cap in aggregates; seven days and twenty meaningful recent ticks maximum. No spend admission or mutation.';
reset lock_timeout;
