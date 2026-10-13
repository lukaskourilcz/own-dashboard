-- Optional staging pilot: one immutable window per owner, never a rolling quota.
-- Reservations survive failures, ambiguous calls, job deletion and env removal.
create schema marketing_private;
revoke all on schema marketing_private from public,anon,authenticated;
grant usage on schema marketing_private to service_role;
create table marketing_private.generation_pilots (
 user_id uuid primary key, starts_at timestamptz not null, expires_at timestamptz not null,
 check(expires_at>starts_at and expires_at<=starts_at+interval '48 hours')
);
create table marketing_private.generation_pilot_reservations (
 job_id uuid primary key, user_id uuid not null references marketing_private.generation_pilots(user_id),
 reserved_usd numeric(5,2) not null default 0.25 check(reserved_usd=0.25),
 created_at timestamptz not null default clock_timestamp()
);
create index generation_pilot_reservations_owner on marketing_private.generation_pilot_reservations(user_id);
alter table marketing_private.generation_pilots enable row level security;
alter table marketing_private.generation_pilot_reservations enable row level security;
revoke all on marketing_private.generation_pilots,marketing_private.generation_pilot_reservations from public,anon,authenticated,service_role;
grant select,insert on marketing_private.generation_pilots,marketing_private.generation_pilot_reservations to service_role;

-- Keep the existing calendar/lease/idempotency procedures unchanged behind
-- service-only wrappers. Their private schema is not exposed through PostgREST.
alter function public.marketing_enqueue_job(uuid,uuid,text,jsonb) set schema marketing_private;
alter function public.marketing_claim_job(uuid,uuid,uuid) set schema marketing_private;

create function marketing_private.check_generation_pilot(p_owner uuid,p_pilot jsonb,p_register boolean default false)
returns boolean language plpgsql set search_path='' as $$
declare config marketing_private.generation_pilots; starts timestamptz; expires timestamptz;
begin
 if p_owner is null then raise exception 'pilot owner required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'marketing-fixed-pilot',0));
 select * into config from marketing_private.generation_pilots where user_id=p_owner;
 if p_pilot is null then
  if found then raise exception 'pilot configuration required'; end if;
  return false;
 end if;
 if jsonb_typeof(p_pilot)<>'object' or p_pilot - array['ownerId','startsAt','expiresAt'] <> '{}'::jsonb
  or (select count(*) from jsonb_object_keys(p_pilot))<>3 or p_pilot->>'ownerId' is distinct from p_owner::text
  or coalesce(p_pilot->>'startsAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
  or coalesce(p_pilot->>'expiresAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
 then raise exception 'pilot configuration invalid'; end if;
 starts:=(p_pilot->>'startsAt')::timestamptz; expires:=(p_pilot->>'expiresAt')::timestamptz;
 if expires<=starts or expires>starts+interval '48 hours' then raise exception 'pilot configuration invalid'; end if;
 if config.user_id is not null then
  if config.starts_at is distinct from starts or config.expires_at is distinct from expires then raise exception 'pilot configuration changed'; end if;
 elsif p_register then
  insert into marketing_private.generation_pilots values(p_owner,starts,expires);
 else raise exception 'pilot reservation required'; end if;
 -- Use wall-clock time after acquiring the lock, not the transaction start.
 if clock_timestamp()<starts or clock_timestamp()>=expires then raise exception 'pilot outside window'; end if;
 return true;
end $$;

create function public.marketing_enqueue_job(p_owner uuid,p_key uuid,p_hash text,p_request jsonb,p_pilot jsonb default null)
returns jsonb language plpgsql set search_path='' as $$
declare pilot boolean; result jsonb; reservation marketing_private.generation_pilot_reservations; jobs integer; dollars numeric;
begin
 pilot:=marketing_private.check_generation_pilot(p_owner,p_pilot,true);
 result:=marketing_private.marketing_enqueue_job(p_owner,p_key,p_hash,p_request);
 if pilot then
  select * into reservation from marketing_private.generation_pilot_reservations where job_id=(result->>'jobId')::uuid;
  if found then
   if reservation.user_id<>p_owner then raise exception 'pilot owner mismatch'; end if;
  else
   if (result->>'duplicate')::boolean then raise exception 'pilot job not reserved'; end if;
   select count(*),coalesce(sum(reserved_usd),0) into jobs,dollars from marketing_private.generation_pilot_reservations where user_id=p_owner;
   if jobs>=3 or dollars+0.25>0.75 then raise exception 'pilot budget exhausted'; end if;
   insert into marketing_private.generation_pilot_reservations(job_id,user_id) values((result->>'jobId')::uuid,p_owner);
  end if;
 end if;
 return result;
end $$;
create function public.marketing_claim_job(p_owner uuid,p_job uuid,p_fence uuid,p_pilot jsonb default null)
returns jsonb language plpgsql set search_path='' as $$
declare pilot boolean;
begin
 pilot:=marketing_private.check_generation_pilot(p_owner,p_pilot);
 if pilot and not exists(select 1 from marketing_private.generation_pilot_reservations where job_id=p_job and user_id=p_owner) then raise exception 'pilot job not reserved'; end if;
 return marketing_private.marketing_claim_job(p_owner,p_job,p_fence);
end $$;
create function public.marketing_check_pilot_attempt(p_owner uuid,p_job uuid,p_fence uuid,p_pilot jsonb)
returns boolean language plpgsql set search_path='' as $$
begin
 if not marketing_private.check_generation_pilot(p_owner,p_pilot) then raise exception 'pilot configuration required'; end if;
 if not exists(select 1 from marketing_private.generation_pilot_reservations r
  join public.marketing_jobs j on j.id=r.job_id and j.user_id=r.user_id
  where r.job_id=p_job and r.user_id=p_owner and j.status='running' and j.fence=p_fence and j.lease_until>clock_timestamp())
 then raise exception 'pilot fence lost'; end if;
 return true;
end $$;

revoke all on function marketing_private.check_generation_pilot(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function marketing_private.check_generation_pilot(uuid,jsonb,boolean) to service_role;
revoke all on function public.marketing_enqueue_job(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_enqueue_job(uuid,uuid,text,jsonb,jsonb) to service_role;
revoke all on function public.marketing_claim_job(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_claim_job(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.marketing_check_pilot_attempt(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_check_pilot_attempt(uuid,uuid,uuid,jsonb) to service_role;
