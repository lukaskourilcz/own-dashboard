-- Unapplied: separate research ledger. No cron, switch, pipeline guard or historical ledger is changed.
create schema if not exists marketing_private;
revoke all on schema marketing_private from public, anon, authenticated;
grant usage on schema marketing_private to service_role;

create table marketing_private.dneskai_apify_research (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 plan_id text not null check (plan_id ~ '^[a-f0-9]{64}$'),
 item_key text not null check (item_key ~ '^[a-z][a-z0-9-]{0,79}$'),
 run_index integer not null check (run_index between 0 and 1000),
 actor_id text not null check (actor_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 build text not null check (build ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
 target_hash text not null check (target_hash ~ '^[a-f0-9]{64}$'),
 cap_usd numeric(12,6) not null check (cap_usd > 0 and cap_usd <= 5),
 status text not null default 'reserved' check (status in ('reserved','started','settled','ambiguous')),
 apify_run_id text check (apify_run_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 cost_usd numeric(12,6) check (cost_usd >= 0 and cost_usd < 'Infinity'::numeric),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique (user_id, plan_id, item_key, run_index),
 unique (user_id, id),
 check ((status = 'settled') = (cost_usd is not null)),
 check (status <> 'started' or apify_run_id is not null)
);
create unique index dneskai_research_remote_run on marketing_private.dneskai_apify_research(apify_run_id) where apify_run_id is not null;
alter table marketing_private.dneskai_apify_research enable row level security;
revoke all on marketing_private.dneskai_apify_research from public, anon, authenticated, service_role;
grant select, insert, update on marketing_private.dneskai_apify_research to service_role;

-- No time window and no plan filter: changing or re-approving a plan never resets the $150 pool.
create function public.marketing_dneskai_apify_research_spent(p_owner uuid)
returns numeric language sql set search_path = '' as $$
 select coalesce(sum(coalesce(cost_usd,cap_usd)),0)
 from marketing_private.dneskai_apify_research where user_id=p_owner
$$;
revoke all on function public.marketing_dneskai_apify_research_spent(uuid) from public, anon, authenticated;
grant execute on function public.marketing_dneskai_apify_research_spent(uuid) to service_role;

create function public.marketing_reserve_dneskai_apify_research(
 p_owner uuid,p_plan text,p_item text,p_run integer,p_actor text,p_build text,p_cap numeric,p_target_hash text,p_ceiling numeric
) returns jsonb language plpgsql set search_path = '' as $$
declare spent numeric; r marketing_private.dneskai_apify_research;
begin
 if p_owner is null or p_ceiling is null or not (p_ceiling>0 and p_ceiling<=150)
  or p_cap is null or not (p_cap>0 and p_cap<=5) then raise exception 'research reservation invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-apify-research',0));
 spent:=public.marketing_dneskai_apify_research_spent(p_owner);
 if exists(select 1 from marketing_private.dneskai_apify_research where user_id=p_owner and plan_id=p_plan and item_key=p_item and run_index=p_run) then
  return jsonb_build_object('admitted',false,'reason','duplicate','spentUsd',spent);
 end if;
 if spent+p_cap>p_ceiling then return jsonb_build_object('admitted',false,'reason','ceiling','spentUsd',spent); end if;
 insert into marketing_private.dneskai_apify_research(user_id,plan_id,item_key,run_index,actor_id,build,cap_usd,target_hash)
 values(p_owner,p_plan,p_item,p_run,p_actor,p_build,p_cap,p_target_hash) returning * into r;
 return jsonb_build_object('admitted',true,'spentUsd',spent,'reservation',jsonb_build_object(
  'id',r.id,'planId',r.plan_id,'itemKey',r.item_key,'runIndex',r.run_index,'capUsd',r.cap_usd,
  'status',r.status,'apifyRunId',r.apify_run_id,'costUsd',r.cost_usd));
end $$;
revoke all on function public.marketing_reserve_dneskai_apify_research(uuid,text,text,integer,text,text,numeric,text,numeric) from public, anon, authenticated;
grant execute on function public.marketing_reserve_dneskai_apify_research(uuid,text,text,integer,text,text,numeric,text,numeric) to service_role;

create function public.marketing_mark_dneskai_apify_research(p_owner uuid,p_reservation uuid,p_status text,p_apify_run text default null,p_cost numeric default null)
returns void language plpgsql set search_path = '' as $$
declare r marketing_private.dneskai_apify_research;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-apify-research',0));
 select * into r from marketing_private.dneskai_apify_research where id=p_reservation and user_id=p_owner for update;
 if not found then raise exception 'research reservation unavailable'; end if;
 if p_status is null or p_status not in ('started','settled','ambiguous')
  or ((p_status='settled') is distinct from (p_cost is not null))
  or (p_cost is not null and not (p_cost>=0 and p_cost<'Infinity'::numeric)) then raise exception 'research update invalid'; end if;
 if r.status='settled' then
  if p_status='settled' and r.cost_usd=p_cost and (p_apify_run is null or p_apify_run=r.apify_run_id) then return; end if;
  raise exception 'research settlement immutable';
 end if;
 if r.apify_run_id is not null and p_apify_run is not null and r.apify_run_id<>p_apify_run then raise exception 'research run identity changed'; end if;
 if p_status='started' and (r.status not in ('reserved','started') or coalesce(p_apify_run,r.apify_run_id) is null) then raise exception 'research start invalid'; end if;
 update marketing_private.dneskai_apify_research set status=p_status,apify_run_id=coalesce(apify_run_id,p_apify_run),cost_usd=p_cost,updated_at=clock_timestamp()
 where id=r.id;
end $$;
revoke all on function public.marketing_mark_dneskai_apify_research(uuid,uuid,text,text,numeric) from public, anon, authenticated;
grant execute on function public.marketing_mark_dneskai_apify_research(uuid,uuid,text,text,numeric) to service_role;

-- Derived public-post features only. No captions, media, comments, usernames outside the approved public list,
-- or dataset payloads. Each snapshot binds a ledger reservation; missing counts stay JSON null.
create table public.marketing_dneskai_research_metrics (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 reservation_id uuid not null,
 short_code text not null check (short_code ~ '^[A-Za-z0-9_-]{5,40}$'),
 account_handle text not null check (account_handle ~ '^[A-Za-z0-9_.]{1,30}$'),
 posted_at timestamptz,
 observed_at timestamptz not null default clock_timestamp(),
 features jsonb not null check (jsonb_typeof(features)='object' and octet_length(features::text)<=10000
  and features - array['type','productType','slideCount','videoSlideCount','captionLength','captionLineCount','firstLineLength','firstLineQuestion','hashtagCount','mentionCount','emojiCount','cta','collaboratorCount','paidPartnership','musicPresent','musicOriginalAudio','musicAudioId','likes','likesHidden','comments','views','plays','shares']::text[]='{}'::jsonb),
 unique (user_id,reservation_id,short_code),
 foreign key (user_id,reservation_id) references marketing_private.dneskai_apify_research(user_id,id)
);
alter table public.marketing_dneskai_research_metrics enable row level security;
create policy owner_read on public.marketing_dneskai_research_metrics for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.marketing_dneskai_research_metrics from public, anon, authenticated, service_role;
grant select on public.marketing_dneskai_research_metrics to authenticated;
grant select, insert on public.marketing_dneskai_research_metrics to service_role;
