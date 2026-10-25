-- Prepared only; not applied. Serialize one TikTok chart reservation per Prague calendar day,
-- independently of its existing rolling 24-hour spend ceiling. Keep ambiguous/settled rows as evidence.
-- The existing (user_id,kind,reserved_at) index supports the two timestamp bounds; no new index is needed.
create or replace function public.marketing_reserve_dneskai_topic_spend(
 p_owner uuid,p_kind text,p_ref text,p_reservation numeric,p_ceiling numeric
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare spent numeric; v_id uuid; v_reserved_at timestamptz; v_day date;
begin
 if p_owner is null or p_kind is null or p_kind not in('transcript','classify','title','tiktok') or p_ref is null or char_length(p_ref) not between 1 and 300
  or p_reservation is null or p_reservation<=0 or p_reservation>1 or p_ceiling is null or p_ceiling<=0 or p_ceiling>50 then raise exception 'topic reservation invalid'; end if;
 if p_kind='transcript' then
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-transcript-budget',0));
  spent:=public.marketing_dneskai_topic_spent(p_owner,array['transcript']);
 elsif p_kind='tiktok' then
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-tiktok-budget',0));
  -- Capture only after waiting for the lock. Admission and insertion use this same instant,
  -- including across midnight. A local date + 1 handles both 23-hour and 25-hour Prague days.
  v_reserved_at:=clock_timestamp();
  v_day:=(v_reserved_at at time zone 'Europe/Prague')::date;
  spent:=public.marketing_dneskai_topic_spent(p_owner,array['tiktok']);
  if exists(select 1 from marketing_private.dneskai_topic_spend s
   where s.user_id=p_owner and s.kind='tiktok'
    and s.reserved_at>=(v_day::timestamp at time zone 'Europe/Prague')
    and s.reserved_at<((v_day+1)::timestamp at time zone 'Europe/Prague')) then
   return jsonb_build_object('admitted',false,'spentUsd',spent,'reservationUsd',p_reservation,'ceilingUsd',p_ceiling);
  end if;
 else
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-generation-budget',0));
  spent:=public.marketing_dneskai_generation_spent(p_owner,null);
 end if;
 if spent+p_reservation>p_ceiling then
  return jsonb_build_object('admitted',false,'spentUsd',spent,'reservationUsd',p_reservation,'ceilingUsd',p_ceiling);
 end if;
 if p_kind='tiktok' then
  insert into marketing_private.dneskai_topic_spend(user_id,kind,ref,reserved_usd,reserved_at)
   values(p_owner,p_kind,p_ref,p_reservation,v_reserved_at) returning id into v_id;
 else
  insert into marketing_private.dneskai_topic_spend(user_id,kind,ref,reserved_usd)
   values(p_owner,p_kind,p_ref,p_reservation) returning id into v_id;
 end if;
 return jsonb_build_object('admitted',true,'id',v_id,'spentUsd',spent,'reservationUsd',p_reservation,'ceilingUsd',p_ceiling);
end $$;
revoke all on function public.marketing_reserve_dneskai_topic_spend(uuid,text,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.marketing_reserve_dneskai_topic_spend(uuid,text,text,numeric,numeric) to service_role;
