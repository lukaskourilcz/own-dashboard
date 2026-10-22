-- Prepared only; not applied. The spend ledger for paid work on DNESKAi topics (#152, plan A3; reused by A4 titling).
--
-- Three kinds of paid call are reserved here before they start and settled after they finish:
--   transcript  an Apify reel transcript, under its own daily ceiling (MARKETING_DNESKAI_TRANSCRIPT_DAILY_USD, $0.50);
--   classify    one Claude call that reads a FACT or HYPE reel's transcript;
--   title       one Claude call that writes the night's working titles (A4).
-- The two model kinds share the existing DNESKAi generation ceiling ($1 a day): marketing_dneskai_generation_spent
-- now adds them, so a generation job and a topic call never pass the ceiling together. Both reserve under the same
-- advisory lock as marketing_reserve_dneskai_generation. A row counts at its settled cost once settled and at its
-- full reservation until then (unknown is the most it could have cost). Rows are never deleted; the 24-hour window
-- moves past them. The application calls these functions only with DNESKAI_FACT_OR_HYPE_ENABLED or the titling switch.

create table marketing_private.dneskai_topic_spend (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in('transcript','classify','title')),
 ref text not null check(char_length(ref) between 1 and 300),
 reserved_usd numeric(8,4) not null check(reserved_usd>0 and reserved_usd<=1),
 cost_usd numeric(8,4) check(cost_usd is null or cost_usd>=0),
 reserved_at timestamptz not null default clock_timestamp(),
 settled_at timestamptz,
 check((cost_usd is null)=(settled_at is null))
);
create index dneskai_topic_spend_window on marketing_private.dneskai_topic_spend(user_id,kind,reserved_at);
alter table marketing_private.dneskai_topic_spend enable row level security;
create policy owner_read on marketing_private.dneskai_topic_spend for select to authenticated using ((select auth.uid())=user_id);
revoke all on marketing_private.dneskai_topic_spend from public,anon,authenticated,service_role;
grant select,insert,update on marketing_private.dneskai_topic_spend to service_role;

-- Topic spend of the last 24 hours for the given kinds: settled cost, or the reservation while unsettled.
create function public.marketing_dneskai_topic_spent(p_owner uuid,p_kinds text[]) returns numeric language sql set search_path='' as $$
 select coalesce(sum(coalesce(s.cost_usd,s.reserved_usd)),0) from marketing_private.dneskai_topic_spend s
 where s.user_id=p_owner and s.kind=any(p_kinds) and s.reserved_at>clock_timestamp()-interval '24 hours'
$$;
revoke all on function public.marketing_dneskai_topic_spent(uuid,text[]) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_topic_spent(uuid,text[]) to service_role;

-- The body of 20261021124651 plus the topic model calls, so the $1 ceiling covers generation and topics together.
create or replace function public.marketing_dneskai_generation_spent(p_owner uuid,p_except uuid default null)
returns numeric language sql set search_path='' as $$
 select coalesce(sum(case
   when j.status in ('review','failed') then case
    when jsonb_typeof(j.result->'usage'->'estimatedCostUsd')='number' then case
     when (j.result->'usage'->>'estimatedCostUsd')::numeric>=0 then (j.result->'usage'->>'estimatedCostUsd')::numeric
     else s.reserved_usd end
    else s.reserved_usd end
   else s.reserved_usd end),0)
  +public.marketing_dneskai_topic_spent(p_owner,array['classify','title'])
 from marketing_private.dneskai_generation_spend s
 left join public.marketing_jobs j on j.id=s.job_id and j.user_id=s.user_id
 where s.user_id=p_owner and s.job_id is distinct from p_except and s.last_reserved_at>clock_timestamp()-interval '24 hours'
$$;

-- Reserve one paid topic call. A transcript is checked against p_ceiling with transcript spend only; a model call
-- against p_ceiling with generation and topic model spend together. A refused call reserves nothing.
create function public.marketing_reserve_dneskai_topic_spend(p_owner uuid,p_kind text,p_ref text,p_reservation numeric,p_ceiling numeric)
returns jsonb language plpgsql set search_path='' as $$
declare spent numeric; v_id uuid;
begin
 if p_owner is null or p_kind is null or p_kind not in('transcript','classify','title') or p_ref is null or char_length(p_ref) not between 1 and 300
  or p_reservation is null or p_reservation<=0 or p_reservation>1 or p_ceiling is null or p_ceiling<=0 or p_ceiling>50 then raise exception 'topic reservation invalid'; end if;
 if p_kind='transcript' then
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-transcript-budget',0));
  spent:=public.marketing_dneskai_topic_spent(p_owner,array['transcript']);
 else
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-generation-budget',0));
  spent:=public.marketing_dneskai_generation_spent(p_owner,null);
 end if;
 if spent+p_reservation>p_ceiling then
  return jsonb_build_object('admitted',false,'spentUsd',spent,'reservationUsd',p_reservation,'ceilingUsd',p_ceiling);
 end if;
 insert into marketing_private.dneskai_topic_spend(user_id,kind,ref,reserved_usd) values(p_owner,p_kind,p_ref,p_reservation) returning id into v_id;
 return jsonb_build_object('admitted',true,'id',v_id,'spentUsd',spent,'reservationUsd',p_reservation,'ceilingUsd',p_ceiling);
end $$;
revoke all on function public.marketing_reserve_dneskai_topic_spend(uuid,text,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.marketing_reserve_dneskai_topic_spend(uuid,text,text,numeric,numeric) to service_role;

-- Settle a reservation once with the measured cost. A second settle is refused, so a retried poll never rewrites it.
create function public.marketing_settle_dneskai_topic_spend(p_owner uuid,p_id uuid,p_cost numeric) returns boolean language plpgsql set search_path='' as $$
begin
 if p_owner is null or p_id is null or p_cost is null or p_cost<0 or p_cost>10 then raise exception 'topic settlement invalid'; end if;
 update marketing_private.dneskai_topic_spend set cost_usd=p_cost,settled_at=clock_timestamp() where id=p_id and user_id=p_owner and settled_at is null;
 return found;
end $$;
revoke all on function public.marketing_settle_dneskai_topic_spend(uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.marketing_settle_dneskai_topic_spend(uuid,uuid,numeric) to service_role;
