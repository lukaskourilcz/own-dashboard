-- Preserve original paid intent and provider identity without storing credentials or guessing legacy admissions.
set lock_timeout='5s';
alter table marketing_private.dneskai_topic_spend add column tiktok_admission jsonb, add column tiktok_binding jsonb,
 add constraint dneskai_tiktok_admission_shape check(tiktok_admission is null or (kind='tiktok' and jsonb_typeof(tiktok_admission)='object' and octet_length(tiktok_admission::text)<=8192)),
 add constraint dneskai_tiktok_binding_shape check(tiktok_binding is null or (tiktok_admission is not null and jsonb_typeof(tiktok_binding)='object' and octet_length(tiktok_binding::text)<=16384));

create function public.reserve_dneskai_tiktok_run(p_owner uuid,p_account uuid,p_remote text,p_verified_at timestamptz,p_enabled boolean,p_day date,p_requested_at timestamptz,p_ceiling numeric)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare decision jsonb; admission jsonb; ledger marketing_private.dneskai_topic_spend%rowtype; confirmed marketing_private.dneskai_topic_spend%rowtype; spent numeric;
begin
 if current_user<>'service_role' then raise exception 'TikTok admission unavailable' using errcode='42501';end if;
 if p_owner is null or p_account is null or p_remote is null or p_remote !~ '^[0-9]{1,100}$' or p_verified_at is null or not isfinite(p_verified_at)
  or p_enabled is null or p_day is null or not isfinite(p_day) or p_requested_at is null or not isfinite(p_requested_at) or p_verified_at>p_requested_at
  or p_requested_at not between clock_timestamp()-interval '5 minutes' and clock_timestamp()+interval '5 minutes'
  or (p_requested_at at time zone 'Europe/Prague')::date<>p_day or p_ceiling is null or p_ceiling<=0 or p_ceiling>1 then
  raise exception 'TikTok admission invalid' using errcode='22023';end if;
 perform 1 from public.marketing_accounts where id=p_account and user_id=p_owner and brand='dneskai' and platform='instagram'
  and remote_account_id=p_remote and verified_at=p_verified_at and enabled=p_enabled for share;
 if not found then raise exception 'TikTok admission account changed' using errcode='40001';end if;
 if (clock_timestamp() at time zone 'Europe/Prague')::date<>p_day then raise exception 'TikTok admission day changed' using errcode='40001';end if;
 -- Reuse migration 124's Prague-day and rolling-spend admission under its existing owner budget lock.
 decision:=public.marketing_reserve_dneskai_topic_spend(p_owner,'tiktok','tiktok:pending',0.1,p_ceiling);
 if decision is null or jsonb_typeof(decision) is distinct from 'object' or jsonb_typeof(decision->'admitted') is distinct from 'boolean' or jsonb_typeof(decision->'spentUsd') is distinct from 'number'
  or (decision->>'spentUsd')::numeric not between 0 and 100000000 then raise exception 'TikTok admission unconfirmed' using errcode='40001';end if;
 spent:=(decision->>'spentUsd')::numeric;
 admission:=jsonb_build_object('ownerId',p_owner,'accountId',p_account,'remoteAccountId',p_remote,'verifiedAt',p_verified_at,'enabled',p_enabled,
  'day',p_day,'requestedAt',p_requested_at,'actorId','sDvA9jM4WRTDX4Syr','actorName','clockworks~tiktok-trends-scraper',
  'input',jsonb_build_object('adsScrapeSounds',true,'adsSoundsCountryCode','CZ','adsRankType','surging','adsScrapeHashtags',false,'adsScrapeCreators',false,'adsScrapeVideos',false,'resultsPerPage',25),
  'reservationUsd',0.1,'ceilingUsd',p_ceiling,'spentUsd',spent,'admitted',(decision->>'admitted')::boolean,'spendId',null,'reservedAt',null);
 if not (decision->>'admitted')::boolean then
  if decision ? 'id' then raise exception 'TikTok admission unconfirmed' using errcode='40001';end if;
  return admission;
 end if;
 if spent+0.1>p_ceiling or jsonb_typeof(decision->'id')<>'string' then raise exception 'TikTok admission unconfirmed' using errcode='40001';end if;
 select * into ledger from marketing_private.dneskai_topic_spend where id=(decision->>'id')::uuid and user_id=p_owner and kind='tiktok' for update;
 if not found or ledger.ref<>'tiktok:pending' or ledger.reserved_usd<>0.1 or ledger.settled_at is not null or ledger.cost_usd is not null
  or ledger.tiktok_receipt is not null or ledger.tiktok_admission is not null or ledger.tiktok_binding is not null or not isfinite(ledger.reserved_at)
  or ledger.reserved_at not between p_requested_at-interval '5 minutes' and clock_timestamp()
  or (ledger.reserved_at at time zone 'Europe/Prague')::date<>p_day or (clock_timestamp() at time zone 'Europe/Prague')::date<>p_day then
  raise exception 'TikTok admission unconfirmed' using errcode='40001';end if;
 admission:=admission||jsonb_build_object('spendId',ledger.id,'reservedAt',ledger.reserved_at);
 update marketing_private.dneskai_topic_spend set tiktok_admission=admission where id=ledger.id and user_id=p_owner and tiktok_admission is null returning * into confirmed;
 if not found or confirmed.tiktok_admission is distinct from admission
  or (confirmed.id,confirmed.user_id,confirmed.kind,confirmed.ref,confirmed.reserved_usd,confirmed.reserved_at,confirmed.cost_usd,confirmed.settled_at,confirmed.tiktok_receipt,confirmed.tiktok_binding)
   is distinct from (ledger.id,p_owner,'tiktok','tiktok:pending',0.1::numeric,ledger.reserved_at,null::numeric,null::timestamptz,null::jsonb,null::jsonb) then
  raise exception 'TikTok admission unconfirmed' using errcode='40001';end if;
 return admission;
end $$;
revoke all on function public.reserve_dneskai_tiktok_run(uuid,uuid,text,timestamptz,boolean,date,timestamptz,numeric) from public,anon,authenticated,service_role;
grant execute on function public.reserve_dneskai_tiktok_run(uuid,uuid,text,timestamptz,boolean,date,timestamptz,numeric) to service_role;

create function public.bind_dneskai_tiktok_run(p_owner uuid,p_admission jsonb,p_provider jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare ledger marketing_private.dneskai_topic_spend%rowtype; confirmed marketing_private.dneskai_topic_spend%rowtype; binding jsonb; started timestamptz; bound_at timestamptz; v_ref text;
begin
 if current_user<>'service_role' then raise exception 'TikTok binding unavailable' using errcode='42501';end if;
 if p_owner is null or p_admission is null or jsonb_typeof(p_admission)<>'object' or octet_length(p_admission::text)>8192
  or p_admission->>'ownerId' is distinct from p_owner::text or p_admission->'admitted' is distinct from 'true'::jsonb
  or p_provider is null or jsonb_typeof(p_provider)<>'object' or octet_length(p_provider::text)>4096
  or (select array_agg(k order by k) from jsonb_object_keys(p_provider) k) is distinct from array['actorId','datasetId','id','startedAt']::text[]
  or jsonb_typeof(p_provider->'id')<>'string' or p_provider->>'id' !~ '^[A-Za-z0-9_-]{1,100}$'
  or jsonb_typeof(p_provider->'datasetId')<>'string' or p_provider->>'datasetId' !~ '^[A-Za-z0-9_-]{1,100}$'
  or p_provider->>'actorId' is distinct from 'sDvA9jM4WRTDX4Syr' or jsonb_typeof(p_provider->'startedAt')<>'string' or length(p_provider->>'startedAt')>40
  or p_provider->>'startedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-2][0-9]:[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-][0-2][0-9]:[0-5][0-9])$' then
  raise exception 'TikTok binding invalid' using errcode='22023';end if;
 started:=(p_provider->>'startedAt')::timestamptz;
 if not isfinite(started) or started>clock_timestamp()+interval '5 minutes' then raise exception 'TikTok binding invalid' using errcode='22023';end if;
 v_ref:='tiktok:'||(p_provider->>'id')||':'||(p_provider->>'datasetId');
 -- Binding records the already-started run against original admission even if the account has since changed.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-tiktok-budget',0));
 select * into ledger from marketing_private.dneskai_topic_spend where id=(p_admission->>'spendId')::uuid and user_id=p_owner and kind='tiktok' for update;
 if not found or ledger.tiktok_admission is distinct from p_admission or started<ledger.reserved_at-interval '5 minutes' then
  raise exception 'TikTok binding changed' using errcode='40001';end if;
 if ledger.tiktok_binding is not null then
  if ledger.tiktok_binding->'admission' is distinct from p_admission or ledger.tiktok_binding->'provider' is distinct from p_provider or ledger.ref is distinct from v_ref then
   raise exception 'TikTok binding conflict' using errcode='40001';end if;
  return ledger.tiktok_binding;
 end if;
 if ledger.ref<>'tiktok:pending' or ledger.settled_at is not null or ledger.tiktok_receipt is not null
  or exists(select 1 from marketing_private.dneskai_topic_spend s where s.user_id=p_owner and s.kind='tiktok' and s.id<>ledger.id and split_part(s.ref,':',2)=p_provider->>'id') then
  raise exception 'TikTok binding conflict' using errcode='40001';end if;
 bound_at:=clock_timestamp();
 if bound_at<ledger.reserved_at then raise exception 'TikTok binding clock changed' using errcode='40001';end if;
 binding:=jsonb_build_object('admission',p_admission,'provider',p_provider,'ref',v_ref,'boundAt',bound_at);
 update marketing_private.dneskai_topic_spend set ref=v_ref,tiktok_binding=binding where id=ledger.id and user_id=p_owner and tiktok_binding is null returning * into confirmed;
 if not found or confirmed.tiktok_binding is distinct from binding or confirmed.tiktok_admission is distinct from p_admission
  or (confirmed.id,confirmed.user_id,confirmed.kind,confirmed.ref,confirmed.reserved_usd,confirmed.reserved_at,confirmed.cost_usd,confirmed.settled_at,confirmed.tiktok_receipt)
   is distinct from (ledger.id,p_owner,'tiktok',v_ref,ledger.reserved_usd,ledger.reserved_at,null::numeric,null::timestamptz,null::jsonb) then
  raise exception 'TikTok binding unconfirmed' using errcode='40001';end if;
 return binding;
end $$;
revoke all on function public.bind_dneskai_tiktok_run(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.bind_dneskai_tiktok_run(uuid,jsonb,jsonb) to service_role;

create function marketing_private.guard_dneskai_tiktok_admission() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.tiktok_admission is not null then
  if (new.id,new.user_id,new.kind,new.reserved_usd,new.reserved_at,new.tiktok_admission) is distinct from (old.id,old.user_id,old.kind,old.reserved_usd,old.reserved_at,old.tiktok_admission)
   or (old.tiktok_binding is not null and (new.ref,new.tiktok_binding) is distinct from (old.ref,old.tiktok_binding))
   or (new.ref is distinct from old.ref and (new.tiktok_binding is null or new.tiktok_binding->>'ref' is distinct from new.ref))
   or ((new.cost_usd,new.settled_at) is distinct from (old.cost_usd,old.settled_at) and new.tiktok_receipt is null) then
   raise exception 'TikTok admission proof required' using errcode='40001';end if;
 end if;
 return new;
end $$;
revoke all on function marketing_private.guard_dneskai_tiktok_admission() from public,anon,authenticated,service_role;
create trigger guard_dneskai_tiktok_admission after update on marketing_private.dneskai_topic_spend for each row execute function marketing_private.guard_dneskai_tiktok_admission();

-- Inspect final row values after all BEFORE triggers; completed records remain immutable too.
drop trigger guard_dneskai_tiktok_completion on marketing_private.dneskai_topic_spend;
create trigger guard_dneskai_tiktok_completion after update on marketing_private.dneskai_topic_spend for each row execute function marketing_private.guard_dneskai_tiktok_completion();
