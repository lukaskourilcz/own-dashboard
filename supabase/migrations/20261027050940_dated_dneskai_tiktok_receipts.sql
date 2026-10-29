-- Dated chart evidence and one atomic completion; never infer proof from old booleans or settlements.
set lock_timeout='5s';
alter table public.marketing_audio_trends
 add column tiktok_seen_on date, add column tiktok_seen_at timestamptz,
 add column tiktok_account_id uuid, add column tiktok_remote_account_id text, add column tiktok_verified_at timestamptz,
 add column tiktok_run_id uuid, add column tiktok_title text, add column tiktok_artist text,
 add constraint marketing_audio_tiktok_proof check (
  (tiktok_seen_on is null and tiktok_seen_at is null and tiktok_account_id is null and tiktok_remote_account_id is null
   and tiktok_verified_at is null and tiktok_run_id is null and tiktok_title is null and tiktok_artist is null)
  or (tiktok_seen_on is not null and tiktok_seen_at is not null and tiktok_account_id is not null and tiktok_remote_account_id is not null
   and tiktok_verified_at is not null and tiktok_run_id is not null and tiktok_title is not null
   and isfinite(tiktok_seen_on) and isfinite(tiktok_seen_at) and isfinite(tiktok_verified_at) and tiktok_verified_at<=tiktok_seen_at
   and tiktok_seen_on<=(tiktok_seen_at at time zone 'Europe/Prague')::date and tiktok_remote_account_id ~ '^[0-9]{1,100}$'
   and length(tiktok_title) between 1 and 300 and btrim(tiktok_title)=tiktok_title and (tiktok_artist is null or length(tiktok_artist)<=300)));
create index marketing_audio_tiktok_recent on public.marketing_audio_trends(user_id,tiktok_seen_on desc,audio_id collate "C") where tiktok_seen_on is not null;
alter table marketing_private.dneskai_topic_spend add column tiktok_fingerprint text, add column tiktok_receipt jsonb,
 add constraint dneskai_tiktok_completion check (
  (tiktok_fingerprint is null and tiktok_receipt is null)
  or (kind='tiktok' and tiktok_fingerprint is not null and tiktok_fingerprint ~ '^[a-f0-9]{64}$' and tiktok_receipt is not null
   and jsonb_typeof(tiktok_receipt)='object' and octet_length(tiktok_receipt::text)<=32768 and settled_at is not null));

create function public.read_dneskai_tiktok_progress(p_owner uuid,p_until timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;
begin
 if current_user<>'service_role' then raise exception 'TikTok progress unavailable' using errcode='42501';end if;
 if p_owner is null or p_until is null or not isfinite(p_until) or p_until>clock_timestamp()+interval '5 minutes' then
  raise exception 'TikTok progress invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'ref',ref,'reserved_at',reserved_at,'settled',settled_at is not null,
  'cost_usd',cost_usd,'reserved_usd',reserved_usd,'processed',tiktok_receipt is not null) order by reserved_at desc,id),'[]'::jsonb) into rows
 from (select id,ref,reserved_at,settled_at,cost_usd,reserved_usd,tiktok_receipt from marketing_private.dneskai_topic_spend
  where user_id=p_owner and kind='tiktok' and reserved_at>p_until-interval '72 hours'
  order by reserved_at desc,id limit 1001) s;
 if jsonb_array_length(rows)>1000 or octet_length(rows::text)>2097152 then raise exception 'TikTok progress too large' using errcode='54000';end if;
 return jsonb_build_object('ownerId',p_owner,'until',p_until,'rows',rows);
end $$;
revoke all on function public.read_dneskai_tiktok_progress(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.read_dneskai_tiktok_progress(uuid,timestamptz) to service_role;

create function public.complete_dneskai_tiktok_run(p_owner uuid,p_account uuid,p_remote text,p_verified_at timestamptz,p_enabled boolean,
 p_spend uuid,p_ref text,p_reserved_at timestamptz,p_day date,p_observed_at timestamptz,p_run jsonb,p_matches jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare ledger marketing_private.dneskai_topic_spend%rowtype; previous public.marketing_audio_trends%rowtype; saved public.marketing_audio_trends%rowtype;
 source_day date; started timestamptz; finished timestamptz; cost numeric; fingerprint text; item jsonb; matches jsonb; rows jsonb:='[]';
 receipt jsonb; completed_at timestamptz; confirmed marketing_private.dneskai_topic_spend%rowtype; outcome text; same_scope boolean;
begin
 if current_user<>'service_role' then raise exception 'TikTok completion unavailable' using errcode='42501';end if;
 if p_owner is null or p_account is null or p_remote is null or p_remote !~ '^[0-9]{1,100}$' or p_verified_at is null or not isfinite(p_verified_at)
  or p_enabled is null or p_spend is null or p_reserved_at is null or not isfinite(p_reserved_at) or p_day is null or not isfinite(p_day)
  or p_observed_at is null or not isfinite(p_observed_at) or p_verified_at>p_observed_at or p_observed_at>clock_timestamp()+interval '5 minutes'
  or (p_observed_at at time zone 'Europe/Prague')::date<>p_day or p_reserved_at>p_observed_at or p_run is null or jsonb_typeof(p_run)<>'object' or octet_length(p_run::text)>4096
  or (select array_agg(k order by k) from jsonb_object_keys(p_run) k) is distinct from array['actorId','datasetId','finishedAt','id','startedAt','status','usageUsd']::text[]
  or p_run->>'actorId'<>'sDvA9jM4WRTDX4Syr' or jsonb_typeof(p_run->'actorId')<>'string'
  or jsonb_typeof(p_run->'id')<>'string' or p_run->>'id' !~ '^[A-Za-z0-9_-]{1,100}$'
  or jsonb_typeof(p_run->'datasetId')<>'string' or p_run->>'datasetId' !~ '^[A-Za-z0-9_-]{1,100}$'
  or p_ref is distinct from 'tiktok:'||(p_run->>'id')||':'||(p_run->>'datasetId')
  or jsonb_typeof(p_run->'startedAt')<>'string' or jsonb_typeof(p_run->'finishedAt')<>'string'
  or length(p_run->>'startedAt')>40 or length(p_run->>'finishedAt')>40
  or p_run->>'startedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-2][0-9]:[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-][0-2][0-9]:[0-5][0-9])$'
  or p_run->>'finishedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-2][0-9]:[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-][0-2][0-9]:[0-5][0-9])$'
  or p_run->>'status' not in ('SUCCEEDED','FAILED','TIMED-OUT','ABORTED') or jsonb_typeof(p_run->'status')<>'string'
  or jsonb_typeof(p_run->'usageUsd')<>'number' or (p_run->>'usageUsd')::numeric not between 0 and 10
  or p_matches is null or jsonb_typeof(p_matches)<>'array' or jsonb_array_length(p_matches)>25 or octet_length(p_matches::text)>65536 then
  raise exception 'TikTok completion invalid' using errcode='22023';end if;
 started:=(p_run->>'startedAt')::timestamptz;finished:=(p_run->>'finishedAt')::timestamptz;
 if not isfinite(started) or not isfinite(finished) or started<p_reserved_at-interval '5 minutes' or finished<started or finished>p_observed_at-interval '10 seconds'
  or exists(select 1 from jsonb_array_elements(p_matches) i where jsonb_typeof(i)<>'object'
   or (select array_agg(k order by k) from jsonb_object_keys(i) k) is distinct from array['artist','audioId','title']::text[]
   or jsonb_typeof(i->'audioId')<>'string' or i->>'audioId' !~ '^[0-9]{1,40}$'
   or jsonb_typeof(i->'title')<>'string' or length(btrim(i->>'title')) not between 1 and 300 or btrim(i->>'title')<>i->>'title'
   or jsonb_typeof(i->'artist') not in ('string','null') or length(i->>'artist')>300)
  or (select count(distinct i->>'audioId') from jsonb_array_elements(p_matches) i)<>jsonb_array_length(p_matches) then
  raise exception 'TikTok completion invalid' using errcode='22023';end if;
 source_day:=(p_reserved_at at time zone 'Europe/Prague')::date;
 if jsonb_array_length(p_matches)>0 and (source_day not between p_day-1 and p_day or p_run->>'status'<>'SUCCEEDED') then
  raise exception 'TikTok signal stale' using errcode='22023';end if;
 select coalesce(jsonb_agg(value order by value->>'audioId' collate "C"),'[]'::jsonb) into matches from jsonb_array_elements(p_matches);
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('owner',p_owner,'account',p_account,'remote',p_remote,'verified',p_verified_at,'enabled',p_enabled,
  'spend',p_spend,'ref',p_ref,'reserved',p_reserved_at,'day',p_day,'observed',p_observed_at,'run',p_run,'matches',matches)::text,'UTF8')),'hex');
 perform 1 from public.marketing_accounts where id=p_account and user_id=p_owner and brand='dneskai' and platform='instagram'
  and remote_account_id=p_remote and verified_at=p_verified_at and enabled=p_enabled for share;
 if not found then raise exception 'TikTok account changed' using errcode='40001';end if;
 select * into ledger from marketing_private.dneskai_topic_spend where id=p_spend and user_id=p_owner and kind='tiktok' for update;
 if not found or ledger.ref is distinct from p_ref or ledger.reserved_at is distinct from p_reserved_at or exists(select 1 from marketing_private.dneskai_topic_spend where user_id=p_owner and kind='tiktok' and ref=p_ref and id<>p_spend) then raise exception 'TikTok run changed' using errcode='40001';end if;
 if ledger.tiktok_receipt is not null then
  if ledger.tiktok_fingerprint is distinct from fingerprint then raise exception 'TikTok completion conflict' using errcode='40001';end if;
  return ledger.tiktok_receipt;
 end if;
 for item in select value from jsonb_array_elements(matches) loop
  if (clock_timestamp() at time zone 'Europe/Prague')::date<>p_day then raise exception 'TikTok day changed' using errcode='40001';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dneskai-audio:'||p_owner::text||':'||(item->>'audioId'),0));
  select * into previous from public.marketing_audio_trends where user_id=p_owner and audio_id=item->>'audioId' for update;
  same_scope:=previous.tiktok_account_id=p_account and previous.tiktok_remote_account_id=p_remote and previous.tiktok_verified_at=p_verified_at;
  outcome:='stored';
  if previous.tiktok_seen_at is not null and ((coalesce(same_scope,false) and (previous.tiktok_seen_on>source_day or (previous.tiktok_seen_on=source_day and previous.tiktok_seen_at>p_observed_at)))
   or (not coalesce(same_scope,false) and previous.tiktok_seen_at>=p_observed_at)) then
   if not coalesce(same_scope,false) then raise exception 'TikTok signal scope changed' using errcode='40001';end if;
   outcome:='superseded';saved:=previous;
  elsif coalesce(same_scope,false) and previous.tiktok_seen_on=source_day and previous.tiktok_seen_at=p_observed_at then
   if (previous.tiktok_title,previous.tiktok_artist,previous.tiktok_run_id) is distinct from (item->>'title',item->>'artist',p_spend) then
    raise exception 'TikTok signal conflict' using errcode='40001';end if;
   saved:=previous;
  else
   insert into public.marketing_audio_trends(user_id,audio_id,title,display_artist,audio_type,first_seen,last_seen,updated_at,
    tiktok_seen_on,tiktok_seen_at,tiktok_account_id,tiktok_remote_account_id,tiktok_verified_at,tiktok_run_id,tiktok_title,tiktok_artist)
   values(p_owner,item->>'audioId',item->>'title',item->>'artist','music',source_day,source_day,p_observed_at,
    source_day,p_observed_at,p_account,p_remote,p_verified_at,p_spend,item->>'title',item->>'artist')
   on conflict(user_id,audio_id) do update set tiktok_seen_on=excluded.tiktok_seen_on,tiktok_seen_at=excluded.tiktok_seen_at,
    tiktok_account_id=excluded.tiktok_account_id,tiktok_remote_account_id=excluded.tiktok_remote_account_id,tiktok_verified_at=excluded.tiktok_verified_at,
    tiktok_run_id=excluded.tiktok_run_id,tiktok_title=excluded.tiktok_title,tiktok_artist=excluded.tiktok_artist returning * into saved;
   if not found or saved.user_id is distinct from p_owner or saved.audio_id is distinct from item->>'audioId' or (saved.tiktok_seen_on,saved.tiktok_seen_at,saved.tiktok_account_id,saved.tiktok_remote_account_id,saved.tiktok_verified_at,saved.tiktok_run_id,saved.tiktok_title,saved.tiktok_artist)
    is distinct from (source_day,p_observed_at,p_account,p_remote,p_verified_at,p_spend,item->>'title',item->>'artist') then
    raise exception 'TikTok signal unconfirmed' using errcode='40001';end if;
   if previous.audio_id is not null and
    (saved.title,saved.display_artist,saved.audio_type,saved.duration_ms,saved.cover_artwork_thumbnail_url,saved.first_seen,saved.last_seen,saved.days_seen,saved.niche_count,saved.tiktok,saved.updated_at,saved.observed_account_id,saved.observed_remote_account_id,saved.observed_verified_at,saved.observed_at)
    is distinct from (previous.title,previous.display_artist,previous.audio_type,previous.duration_ms,previous.cover_artwork_thumbnail_url,previous.first_seen,previous.last_seen,previous.days_seen,previous.niche_count,previous.tiktok,previous.updated_at,previous.observed_account_id,previous.observed_remote_account_id,previous.observed_verified_at,previous.observed_at) then
    raise exception 'TikTok retained history changed' using errcode='40001';end if;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('audioId',saved.audio_id,'outcome',outcome,'sourceDay',saved.tiktok_seen_on,'observedAt',saved.tiktok_seen_at,
   'accountId',saved.tiktok_account_id,'remoteAccountId',saved.tiktok_remote_account_id,'verifiedAt',saved.tiktok_verified_at,'spendId',saved.tiktok_run_id));
 end loop;
 if (clock_timestamp() at time zone 'Europe/Prague')::date<>p_day then raise exception 'TikTok day changed' using errcode='40001';end if;
 cost:=case when ledger.settled_at is not null then ledger.cost_usd else ceil((p_run->>'usageUsd')::numeric*10000)/10000 end;
 completed_at:=clock_timestamp();
 receipt:=jsonb_build_object('ownerId',p_owner,'accountId',p_account,'remoteAccountId',p_remote,'verifiedAt',p_verified_at,'spendId',p_spend,'ref',p_ref,
  'reservedAt',p_reserved_at,'day',p_day,'observedAt',p_observed_at,'sourceDay',source_day,'costUsd',cost,'completedAt',completed_at,'rows',rows);
 update marketing_private.dneskai_topic_spend set cost_usd=cost,settled_at=coalesce(settled_at,completed_at),tiktok_fingerprint=fingerprint,tiktok_receipt=receipt
  where id=p_spend and user_id=p_owner and kind='tiktok' and tiktok_receipt is null and ref=p_ref and reserved_at=p_reserved_at returning * into confirmed;
 if not found or confirmed.tiktok_receipt is distinct from receipt or confirmed.tiktok_fingerprint is distinct from fingerprint
  or (confirmed.id,confirmed.user_id,confirmed.kind,confirmed.ref,confirmed.reserved_usd,confirmed.reserved_at,confirmed.cost_usd) is distinct from (p_spend,p_owner,'tiktok',p_ref,ledger.reserved_usd,p_reserved_at,cost)
  or confirmed.settled_at is distinct from coalesce(ledger.settled_at,completed_at) or not isfinite(confirmed.settled_at) then raise exception 'TikTok completion unconfirmed' using errcode='40001';end if;
 return receipt;
end $$;
revoke all on function public.complete_dneskai_tiktok_run(uuid,uuid,text,timestamptz,boolean,uuid,text,timestamptz,date,timestamptz,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.complete_dneskai_tiktok_run(uuid,uuid,text,timestamptz,boolean,uuid,text,timestamptz,date,timestamptz,jsonb,jsonb) to service_role;

create function marketing_private.guard_dneskai_tiktok_completion() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.tiktok_receipt is not null and (new.id,new.user_id,new.kind,new.ref,new.reserved_usd,new.reserved_at,new.cost_usd,new.settled_at,new.tiktok_receipt,new.tiktok_fingerprint) is distinct from (old.id,old.user_id,old.kind,old.ref,old.reserved_usd,old.reserved_at,old.cost_usd,old.settled_at,old.tiktok_receipt,old.tiktok_fingerprint) then
  raise exception 'TikTok completion immutable' using errcode='40001';end if;
 return new;
end $$;
revoke all on function marketing_private.guard_dneskai_tiktok_completion() from public,anon,authenticated,service_role;
create trigger guard_dneskai_tiktok_completion before update on marketing_private.dneskai_topic_spend for each row execute function marketing_private.guard_dneskai_tiktok_completion();

-- Keep the false/Meta-only transport shape compatible. A true signal adds its explicit source day.
create or replace function public.read_dneskai_audio_observations(p_owner uuid,p_today date) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;
begin
 if current_user<>'service_role' then raise exception 'Audio observation unavailable' using errcode='42501';end if;
 if p_owner is null or p_today is null or not isfinite(p_today) then raise exception 'Audio observation invalid' using errcode='22023';end if;
 with proof as (
  select t.*,coalesce(t.observed_account_id=a.id and t.observed_remote_account_id=a.remote_account_id and t.observed_verified_at=a.verified_at
    and t.last_seen between p_today-1 and p_today and (t.observed_at at time zone 'Europe/Prague')::date between p_today-1 and p_today,false) meta,
   coalesce(t.tiktok_account_id=a.id and t.tiktok_remote_account_id=a.remote_account_id and t.tiktok_verified_at=a.verified_at
    and t.tiktok_seen_on between p_today-1 and p_today and (t.tiktok_seen_at at time zone 'Europe/Prague')::date between p_today-1 and p_today,false) signal
  from public.marketing_audio_trends t join public.marketing_accounts a on a.user_id=t.user_id and a.brand='dneskai' and a.platform='instagram'
  where t.user_id=p_owner and a.verified_at is not null and (t.last_seen between p_today-1 and p_today or t.tiktok_seen_on between p_today-1 and p_today)
 ), selected as (
  select audio_id,case when meta then days_seen else 0 end days_seen,
   jsonb_build_object('user_id',user_id,'audio_id',audio_id,'title',case when meta then title else tiktok_title end,
    'display_artist',case when meta then display_artist else tiktok_artist end,'audio_type',case when meta then audio_type else 'music' end,
    'duration_ms',case when meta then duration_ms else null end,'cover_artwork_thumbnail_url',case when meta then cover_artwork_thumbnail_url else null end,
    'days_seen',case when meta then days_seen else 0 end,'tiktok',signal,'last_seen',case when meta then last_seen else tiktok_seen_on end,
    'observed_account_id',case when meta then observed_account_id else tiktok_account_id end,
    'observed_remote_account_id',case when meta then observed_remote_account_id else tiktok_remote_account_id end,
    'observed_verified_at',case when meta then observed_verified_at else tiktok_verified_at end,
    'observed_at',case when meta then observed_at else tiktok_seen_at end)
    ||case when signal then jsonb_build_object('tiktok_seen_on',tiktok_seen_on,'tiktok_seen_at',tiktok_seen_at) else '{}'::jsonb end row
  from proof where meta or signal order by case when meta then days_seen else 0 end desc,audio_id collate "C" limit 50
 ) select coalesce(jsonb_agg(row order by days_seen desc,audio_id collate "C"),'[]'::jsonb) into rows from selected;
 return jsonb_build_object('ownerId',p_owner,'today',p_today,'rows',rows);
end $$;


-- Rolling legacy Meta writes cannot replace history protected by either kind of proof.
create or replace function public.guard_dneskai_audio_observation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (old.observed_at is not null or old.tiktok_seen_at is not null) and
  (new.title,new.display_artist,new.audio_type,new.duration_ms,new.cover_artwork_thumbnail_url,new.first_seen,new.last_seen,new.days_seen)
  is distinct from (old.title,old.display_artist,old.audio_type,old.duration_ms,old.cover_artwork_thumbnail_url,old.first_seen,old.last_seen,old.days_seen)
  and (new.observed_at is null or (new.observed_account_id,new.observed_remote_account_id,new.observed_verified_at,new.observed_at)
  is not distinct from (old.observed_account_id,old.observed_remote_account_id,old.observed_verified_at,old.observed_at)) then
  raise exception 'Audio observation proof required' using errcode='40001';end if;
 return new;
end $$;
