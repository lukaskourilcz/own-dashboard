-- Legacy history is retained, but is not proof of availability for the current account.
set lock_timeout='5s';
alter table public.marketing_audio_trends
 add column observed_account_id uuid,
 add column observed_remote_account_id text,
 add column observed_verified_at timestamptz,
 add column observed_at timestamptz,
 add constraint marketing_audio_observation_proof check (
  (observed_account_id is null and observed_remote_account_id is null and observed_verified_at is null and observed_at is null)
  or (observed_account_id is not null and observed_remote_account_id is not null and observed_verified_at is not null and observed_at is not null
   and observed_remote_account_id ~ '^[0-9]{1,100}$' and isfinite(observed_verified_at) and isfinite(observed_at) and observed_verified_at<=observed_at));

-- An old in-flight upsert must not leave new proof attached to overwritten metadata.
create function public.guard_dneskai_audio_observation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.observed_at is not null and
  (new.title,new.display_artist,new.audio_type,new.duration_ms,new.cover_artwork_thumbnail_url,new.first_seen,new.last_seen,new.days_seen)
  is distinct from (old.title,old.display_artist,old.audio_type,old.duration_ms,old.cover_artwork_thumbnail_url,old.first_seen,old.last_seen,old.days_seen)
  and (new.observed_account_id,new.observed_remote_account_id,new.observed_verified_at,new.observed_at)
  is not distinct from (old.observed_account_id,old.observed_remote_account_id,old.observed_verified_at,old.observed_at) then
  raise exception 'Audio observation proof required' using errcode='40001';end if;
 return new;
end $$;
revoke all on function public.guard_dneskai_audio_observation() from public,anon,authenticated,service_role;
create trigger guard_dneskai_audio_observation before update on public.marketing_audio_trends for each row execute function public.guard_dneskai_audio_observation();

create function public.record_dneskai_audio_observations(p_owner uuid,p_account uuid,p_remote text,p_verified_at timestamptz,p_enabled boolean,p_day date,p_observed_at timestamptz,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare item jsonb; previous public.marketing_audio_trends%rowtype; saved public.marketing_audio_trends%rowtype;
 rows jsonb:='[]'; outcome text; reply jsonb; same_scope boolean;
begin
 if current_user<>'service_role' then raise exception 'Audio observation unavailable' using errcode='42501';end if;
 if p_owner is null or p_account is null or p_remote is null or p_remote !~ '^[0-9]{1,100}$' or p_verified_at is null or not isfinite(p_verified_at)
  or p_enabled is null or p_day is null or not isfinite(p_day) or p_observed_at is null or not isfinite(p_observed_at)
  or p_verified_at>p_observed_at or p_observed_at>clock_timestamp()+interval '5 minutes'
  or (p_observed_at at time zone 'Europe/Prague')::date<>p_day
  or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>50 or octet_length(p_items::text)>262144 then
  raise exception 'Audio observation invalid' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i)<>'object'
  or (select array_agg(k order by k) from jsonb_object_keys(i) k) is distinct from array['audio_id','audio_type','cover_artwork_thumbnail_url','display_artist','duration_ms','title']::text[]
  or jsonb_typeof(i->'audio_id')<>'string' or i->>'audio_id' !~ '^[0-9]{1,40}$'
  or jsonb_typeof(i->'title')<>'string' or length(btrim(i->>'title')) not between 1 and 300 or btrim(i->>'title')<>i->>'title'
  or jsonb_typeof(i->'audio_type')<>'string' or i->>'audio_type' not in ('music','original_sound')
  or jsonb_typeof(i->'display_artist') not in ('string','null') or length(i->>'display_artist')>300
  or jsonb_typeof(i->'duration_ms') not in ('number','null') or (i->>'duration_ms')::numeric not between 0 and 3600000 or (i->>'duration_ms')::numeric<>trunc((i->>'duration_ms')::numeric)
  or jsonb_typeof(i->'cover_artwork_thumbnail_url') not in ('string','null') or length(i->>'cover_artwork_thumbnail_url')>2048 or i->>'cover_artwork_thumbnail_url' !~ '^https://')
  or (select count(distinct i->>'audio_id') from jsonb_array_elements(p_items) i)<>jsonb_array_length(p_items) then
  raise exception 'Audio observation invalid' using errcode='22023';end if;
 reply:=jsonb_build_object('ownerId',p_owner,'accountId',p_account,'remoteAccountId',p_remote,'verifiedAt',p_verified_at,'day',p_day,'observedAt',p_observed_at);
 -- Lock account before sound rows: re-verification cannot race a successful commit.
 perform 1 from public.marketing_accounts where id=p_account and user_id=p_owner and brand='dneskai' and platform='instagram'
  and remote_account_id=p_remote and verified_at=p_verified_at and enabled=p_enabled for share;
 if not found then return reply||jsonb_build_object('status','account-changed','rows','[]'::jsonb);end if;
 if (clock_timestamp() at time zone 'Europe/Prague')::date<>p_day then return reply||jsonb_build_object('status','day-changed','rows','[]'::jsonb);end if;
 for item in select value from jsonb_array_elements(p_items) order by value->>'audio_id' collate "C" loop
  -- Inserts and updates use the same key lock, including the initially absent row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dneskai-audio:'||p_owner::text||':'||(item->>'audio_id'),0));
  if (clock_timestamp() at time zone 'Europe/Prague')::date<>p_day then raise exception 'Audio observation day changed' using errcode='40001';end if;
  select * into previous from public.marketing_audio_trends where user_id=p_owner and audio_id=item->>'audio_id' for update;
  if previous.last_seen>p_day then raise exception 'Audio observation history conflict' using errcode='40001';end if;
  same_scope:=previous.observed_account_id=p_account and previous.observed_remote_account_id=p_remote and previous.observed_verified_at=p_verified_at;
  outcome:='stored';
  if previous.observed_at is not null and previous.observed_at>p_observed_at then
   if not coalesce(same_scope,false) then raise exception 'Audio observation scope conflict' using errcode='40001';end if;
   outcome:='superseded';saved:=previous;
  elsif previous.observed_at=p_observed_at and same_scope then
   if (previous.title,previous.display_artist,previous.audio_type,previous.duration_ms,previous.cover_artwork_thumbnail_url)
    is distinct from (item->>'title',item->>'display_artist',item->>'audio_type',(item->>'duration_ms')::integer,item->>'cover_artwork_thumbnail_url') then
    raise exception 'Audio observation conflict' using errcode='40001';end if;
   saved:=previous;
  else
   insert into public.marketing_audio_trends(user_id,audio_id,title,display_artist,audio_type,duration_ms,cover_artwork_thumbnail_url,first_seen,last_seen,days_seen,
    observed_account_id,observed_remote_account_id,observed_verified_at,observed_at,updated_at)
   values(p_owner,item->>'audio_id',item->>'title',item->>'display_artist',item->>'audio_type',(item->>'duration_ms')::integer,item->>'cover_artwork_thumbnail_url',
    p_day,p_day,1,p_account,p_remote,p_verified_at,p_observed_at,p_observed_at)
   on conflict(user_id,audio_id) do update set title=excluded.title,display_artist=excluded.display_artist,audio_type=excluded.audio_type,
    duration_ms=excluded.duration_ms,cover_artwork_thumbnail_url=excluded.cover_artwork_thumbnail_url,
    last_seen=greatest(marketing_audio_trends.last_seen,excluded.last_seen),
    days_seen=marketing_audio_trends.days_seen+case when excluded.last_seen>marketing_audio_trends.last_seen then 1 else 0 end,
    observed_account_id=excluded.observed_account_id,observed_remote_account_id=excluded.observed_remote_account_id,
    observed_verified_at=excluded.observed_verified_at,observed_at=excluded.observed_at,updated_at=excluded.updated_at returning * into saved;
   if not found or (saved.title,saved.display_artist,saved.audio_type,saved.duration_ms,saved.cover_artwork_thumbnail_url,
     saved.observed_account_id,saved.observed_remote_account_id,saved.observed_verified_at,saved.observed_at,saved.first_seen,saved.last_seen,saved.days_seen)
    is distinct from (item->>'title',item->>'display_artist',item->>'audio_type',(item->>'duration_ms')::integer,item->>'cover_artwork_thumbnail_url',
     p_account,p_remote,p_verified_at,p_observed_at,coalesce(previous.first_seen,p_day),p_day,
     case when previous.audio_id is null then 1 else previous.days_seen+case when p_day>previous.last_seen then 1 else 0 end end) then
    raise exception 'Audio observation not confirmed' using errcode='40001';end if;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('audioId',saved.audio_id,'outcome',outcome,'title',saved.title,'artist',saved.display_artist,'type',saved.audio_type,
   'durationMs',saved.duration_ms,'coverUrl',saved.cover_artwork_thumbnail_url,'firstSeen',saved.first_seen,'lastSeen',saved.last_seen,'daysSeen',saved.days_seen,
   'accountId',saved.observed_account_id,'remoteAccountId',saved.observed_remote_account_id,'verifiedAt',saved.observed_verified_at,'observedAt',saved.observed_at));
 end loop;
 if (clock_timestamp() at time zone 'Europe/Prague')::date<>p_day then raise exception 'Audio observation day changed' using errcode='40001';end if;
 return reply||jsonb_build_object('status','done','rows',rows);
end $$;
revoke all on function public.record_dneskai_audio_observations(uuid,uuid,text,timestamptz,boolean,date,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_dneskai_audio_observations(uuid,uuid,text,timestamptz,boolean,date,timestamptz,jsonb) to service_role;

create function public.read_dneskai_audio_observations(p_owner uuid,p_today date) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;
begin
 if current_user<>'service_role' then raise exception 'Audio observation unavailable' using errcode='42501';end if;
 if p_owner is null or p_today is null or not isfinite(p_today) then raise exception 'Audio observation invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(row order by days_seen desc,audio_id collate "C"),'[]'::jsonb) into rows from (
  select t.days_seen,t.audio_id,jsonb_build_object('user_id',t.user_id,'audio_id',t.audio_id,'title',t.title,'display_artist',t.display_artist,
   'audio_type',t.audio_type,'duration_ms',t.duration_ms,'cover_artwork_thumbnail_url',t.cover_artwork_thumbnail_url,'days_seen',t.days_seen,
   'tiktok',false,'last_seen',t.last_seen,'observed_account_id',t.observed_account_id,'observed_remote_account_id',t.observed_remote_account_id,
   'observed_verified_at',t.observed_verified_at,'observed_at',t.observed_at) row
  from public.marketing_audio_trends t join public.marketing_accounts a on a.id=t.observed_account_id and a.user_id=t.user_id
   and a.brand='dneskai' and a.platform='instagram' and a.remote_account_id=t.observed_remote_account_id and a.verified_at=t.observed_verified_at
  where t.user_id=p_owner and t.last_seen between p_today-1 and p_today and (t.observed_at at time zone 'Europe/Prague')::date between p_today-1 and p_today
  order by t.days_seen desc,t.audio_id collate "C" limit 50
 ) selected;
 -- Undated legacy TikTok flags are not current cross-platform evidence.
 return jsonb_build_object('ownerId',p_owner,'today',p_today,'rows',rows);
end $$;
revoke all on function public.read_dneskai_audio_observations(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.read_dneskai_audio_observations(uuid,date) to service_role;
