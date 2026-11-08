-- The DNESKAi series refill waves (owner decision, 8 November 2026): about once every two weeks a scheduled job
-- researches new series tips (Apify from prepaid credit only, Claude), and the drafts that pass the code gates are
-- approved automatically. One row is one wave. A wave reserves its whole cap before any paid call and settles its
-- measured cost after; until then it counts at the full cap. A wave is admitted only when no wave of the same owner
-- started in the last p_gap_days days, so a failing wave cannot retry every day and spend again.
-- Rows are never deleted.

create table marketing_private.dneskai_series_waves (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 cap_usd numeric(8,4) not null check(cap_usd>0 and cap_usd<=5),
 cost_usd numeric(8,4) check(cost_usd is null or cost_usd>=0),
 apify_usd numeric(8,4) check(apify_usd is null or apify_usd>=0),
 model_usd numeric(8,4) check(model_usd is null or model_usd>=0),
 inserted integer check(inserted is null or inserted>=0),
 code text check(code is null or code ~ '^[a-z][a-z0-9-]{1,79}$'),
 started_at timestamptz not null default clock_timestamp(),
 settled_at timestamptz,
 check((cost_usd is null)=(settled_at is null))
);
create index dneskai_series_waves_owner on marketing_private.dneskai_series_waves(user_id,started_at desc);
alter table marketing_private.dneskai_series_waves enable row level security;
create policy owner_read on marketing_private.dneskai_series_waves for select to authenticated using ((select auth.uid())=user_id);
revoke all on marketing_private.dneskai_series_waves from public,anon,authenticated,service_role;
grant select,insert,update on marketing_private.dneskai_series_waves to service_role;

-- Reserve one wave. Refused (and nothing written) while another wave of the owner started within p_gap_days.
create function public.marketing_reserve_dneskai_series_wave(p_owner uuid,p_cap numeric,p_gap_days integer)
returns jsonb language plpgsql set search_path='' as $$
declare v_last timestamptz; v_id uuid;
begin
 if p_owner is null or p_cap is null or p_cap<=0 or p_cap>5 or p_gap_days is null or p_gap_days<1 or p_gap_days>60 then
  raise exception 'series wave reservation invalid';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-series-wave',0));
 select max(w.started_at) into v_last from marketing_private.dneskai_series_waves w where w.user_id=p_owner;
 if v_last is not null and v_last>clock_timestamp()-make_interval(days=>p_gap_days) then
  return jsonb_build_object('admitted',false,'lastStartedAt',v_last);
 end if;
 insert into marketing_private.dneskai_series_waves(user_id,cap_usd) values(p_owner,p_cap) returning id into v_id;
 return jsonb_build_object('admitted',true,'id',v_id,'lastStartedAt',v_last);
end $$;
revoke all on function public.marketing_reserve_dneskai_series_wave(uuid,numeric,integer) from public,anon,authenticated;
grant execute on function public.marketing_reserve_dneskai_series_wave(uuid,numeric,integer) to service_role;

-- Settle a wave once with what it measured. A second settle is refused.
create function public.marketing_settle_dneskai_series_wave(p_owner uuid,p_id uuid,p_apify numeric,p_model numeric,p_inserted integer,p_code text)
returns boolean language plpgsql set search_path='' as $$
begin
 if p_owner is null or p_id is null or p_apify is null or p_apify<0 or p_model is null or p_model<0 or p_apify+p_model>10
  or p_inserted is null or p_inserted<0 or (p_code is not null and p_code !~ '^[a-z][a-z0-9-]{1,79}$') then
  raise exception 'series wave settlement invalid';
 end if;
 update marketing_private.dneskai_series_waves set apify_usd=p_apify,model_usd=p_model,cost_usd=p_apify+p_model,inserted=p_inserted,code=p_code,
  settled_at=clock_timestamp() where id=p_id and user_id=p_owner and settled_at is null;
 return found;
end $$;
revoke all on function public.marketing_settle_dneskai_series_wave(uuid,uuid,numeric,numeric,integer,text) from public,anon,authenticated;
grant execute on function public.marketing_settle_dneskai_series_wave(uuid,uuid,numeric,numeric,integer,text) to service_role;
