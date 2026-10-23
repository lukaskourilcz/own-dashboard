-- Prepared only; not applied. The TikTok Creative Center CZ sound chart (#167, plan C5) as a fourth kind of paid topic
-- work in the spend ledger of 20261023100100: one Apify run of clockworks/tiktok-trends-scraper a day, reserved before
-- it starts and settled with its measured cost, under its own daily ceiling (MARKETING_DNESKAI_TIKTOK_DAILY_USD,
-- default $0.10). Like a transcript it has its own lock and counts only its own spend, so it never takes room from
-- generation or transcripts. The application reserves only with DNESKAI_TIKTOK_TRENDS_ENABLED.

alter table marketing_private.dneskai_topic_spend drop constraint dneskai_topic_spend_kind_check;
alter table marketing_private.dneskai_topic_spend add constraint dneskai_topic_spend_kind_check check(kind in('transcript','classify','title','tiktok'));

-- The body of 20261023100100 plus `tiktok`, checked against its own spend under its own lock.
create or replace function public.marketing_reserve_dneskai_topic_spend(p_owner uuid,p_kind text,p_ref text,p_reservation numeric,p_ceiling numeric)
returns jsonb language plpgsql set search_path='' as $$
declare spent numeric; v_id uuid;
begin
 if p_owner is null or p_kind is null or p_kind not in('transcript','classify','title','tiktok') or p_ref is null or char_length(p_ref) not between 1 and 300
  or p_reservation is null or p_reservation<=0 or p_reservation>1 or p_ceiling is null or p_ceiling<=0 or p_ceiling>50 then raise exception 'topic reservation invalid'; end if;
 if p_kind='transcript' then
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-transcript-budget',0));
  spent:=public.marketing_dneskai_topic_spent(p_owner,array['transcript']);
 elsif p_kind='tiktok' then
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-tiktok-budget',0));
  spent:=public.marketing_dneskai_topic_spent(p_owner,array['tiktok']);
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

-- The day's chart run, so the next daily tick can read it: ref is 'tiktok:<run id>:<dataset id>'.
create function public.marketing_dneskai_tiktok_runs(p_owner uuid) returns table(id uuid,ref text,reserved_at timestamptz,settled boolean)
language sql set search_path='' as $$
 select s.id,s.ref,s.reserved_at,s.settled_at is not null from marketing_private.dneskai_topic_spend s
 where s.user_id=p_owner and s.kind='tiktok' and s.reserved_at>clock_timestamp()-interval '3 days' order by s.reserved_at desc limit 5
$$;
revoke all on function public.marketing_dneskai_tiktok_runs(uuid) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_tiktok_runs(uuid) to service_role;

-- A reservation is written before the run starts; once Apify answers, its run and dataset ids replace the placeholder.
create function public.marketing_dneskai_tiktok_bind(p_owner uuid,p_id uuid,p_ref text) returns boolean language plpgsql set search_path='' as $$
begin
 if p_owner is null or p_id is null or p_ref !~ '^tiktok:[A-Za-z0-9_-]{1,100}:[A-Za-z0-9_-]{1,100}$' then raise exception 'tiktok bind invalid'; end if;
 update marketing_private.dneskai_topic_spend set ref=p_ref where id=p_id and user_id=p_owner and kind='tiktok' and settled_at is null and ref='tiktok:pending';
 return found;
end $$;
revoke all on function public.marketing_dneskai_tiktok_bind(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_tiktok_bind(uuid,uuid,text) to service_role;
