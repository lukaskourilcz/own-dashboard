-- #116: the DNESKAi daily generation ceiling. Before every paid model call a DNESKAi generation job
-- reserves its whole maximum here, under one advisory lock per owner, and is refused when the
-- DNESKAi generation spend of the last 24 hours plus that maximum would pass the ceiling the worker
-- passes in (MARKETING_DNESKAI_DAILY_GENERATION_USD, default 1.00).
--
-- A reserved job counts at the cost it recorded in marketing_jobs.result.usage.estimatedCostUsd once
-- it finished (review, or failed with recorded usage). A running job, a job in reconciliation and a
-- finished job without a readable recorded cost count at their full reservation: unknown is the most
-- they could have spent. Rows are never deleted; the 24-hour window moves past them. The October
-- staging pilot ledgers (generation_pilot_reservations) are separate and untouched.
create table marketing_private.dneskai_generation_spend (
 job_id uuid primary key references public.marketing_jobs(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 reserved_usd numeric(8,4) not null check(reserved_usd>0 and reserved_usd<=1),
 calls integer not null default 1 check(calls between 1 and 3),
 first_reserved_at timestamptz not null default clock_timestamp(),
 last_reserved_at timestamptz not null default clock_timestamp()
);
create index dneskai_generation_spend_window on marketing_private.dneskai_generation_spend(user_id,last_reserved_at);
alter table marketing_private.dneskai_generation_spend enable row level security;
create policy owner_read on marketing_private.dneskai_generation_spend for select to authenticated using ((select auth.uid())=user_id);
revoke all on marketing_private.dneskai_generation_spend from public,anon,authenticated,service_role;
grant select,insert,update on marketing_private.dneskai_generation_spend to service_role;

-- DNESKAi generation spend of the last 24 hours, other than p_except's own.
create function public.marketing_dneskai_generation_spent(p_owner uuid,p_except uuid default null)
returns numeric language sql set search_path='' as $$
 -- Nested CASE: the numeric cast runs only on a JSON number, whatever order a planner gives AND.
 select coalesce(sum(case
   when j.status in ('review','failed') then case
    when jsonb_typeof(j.result->'usage'->'estimatedCostUsd')='number' then case
     when (j.result->'usage'->>'estimatedCostUsd')::numeric>=0 then (j.result->'usage'->>'estimatedCostUsd')::numeric
     else s.reserved_usd end
    else s.reserved_usd end
   else s.reserved_usd end),0)
 from marketing_private.dneskai_generation_spend s
 left join public.marketing_jobs j on j.id=s.job_id and j.user_id=s.user_id
 where s.user_id=p_owner and s.job_id is distinct from p_except and s.last_reserved_at>clock_timestamp()-interval '24 hours'
$$;
revoke all on function public.marketing_dneskai_generation_spent(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_generation_spent(uuid,uuid) to service_role;

-- Reserve one paid call of a running DNESKAi job under its fence. Returns whether the call is admitted
-- and the figures it was decided on; a refused call reserves nothing.
create function public.marketing_reserve_dneskai_generation(p_owner uuid,p_job uuid,p_fence uuid,p_reservation numeric,p_ceiling numeric)
returns jsonb language plpgsql set search_path='' as $$
declare j public.marketing_jobs; spent numeric;
begin
 if p_owner is null or p_job is null or p_fence is null
  or p_reservation is null or p_reservation<=0 or p_reservation>1
  or p_ceiling is null or p_ceiling<=0 or p_ceiling>50 then raise exception 'generation reservation invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-generation-budget',0));
 select * into j from public.marketing_jobs where id=p_job and user_id=p_owner;
 if not found or j.status<>'running' or j.fence is distinct from p_fence or j.lease_until is null or j.lease_until<=now() then raise exception 'job fence lost'; end if;
 if j.request->'generation'->'source'->>'brand' is distinct from 'dneskai' then raise exception 'dneskai generation job required'; end if;
 spent:=public.marketing_dneskai_generation_spent(p_owner,p_job);
 if spent+p_reservation>p_ceiling then
  return jsonb_build_object('admitted',false,'spentUsd',spent,'reservationUsd',p_reservation,'ceilingUsd',p_ceiling);
 end if;
 insert into marketing_private.dneskai_generation_spend as s(job_id,user_id,reserved_usd) values(p_job,p_owner,p_reservation)
 on conflict(job_id) do update set calls=s.calls+1,last_reserved_at=clock_timestamp(),reserved_usd=greatest(s.reserved_usd,excluded.reserved_usd);
 return jsonb_build_object('admitted',true,'spentUsd',spent,'reservationUsd',p_reservation,'ceilingUsd',p_ceiling);
end $$;
revoke all on function public.marketing_reserve_dneskai_generation(uuid,uuid,uuid,numeric,numeric) from public,anon,authenticated;
grant execute on function public.marketing_reserve_dneskai_generation(uuid,uuid,uuid,numeric,numeric) to service_role;
