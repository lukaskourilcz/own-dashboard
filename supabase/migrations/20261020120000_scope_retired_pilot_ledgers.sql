-- #113: the October staging pilots are retired. Their ledger rows stay: windows, reservations, the
-- lifetime collection run and every reserved stage are retained, and no row is changed or removed.
-- What changes is how long a row blocks ordinary work. Each guard below now applies only while its
-- pilot window is unexpired, so an expired preview ledger cannot block production admission or
-- paid collection on the same database. During an unexpired window every interlock is unchanged.
-- A pilot tuple still can never open a second window or be replayed after expiry.

create or replace function marketing_private.check_generation_pilot(p_owner uuid,p_pilot jsonb,p_register boolean default false)
returns boolean language plpgsql set search_path='' as $$
declare config marketing_private.generation_pilots; starts timestamptz; expires timestamptz;
begin
 if p_owner is null then raise exception 'pilot owner required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'marketing-fixed-pilot',0));
 select * into config from marketing_private.generation_pilots where user_id=p_owner;
 if p_pilot is null then
  -- Only an unexpired window still requires its tuple; an expired row no longer blocks ordinary admission.
  if found and clock_timestamp()<config.expires_at then raise exception 'pilot configuration required'; end if;
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
revoke all on function marketing_private.check_generation_pilot(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function marketing_private.check_generation_pilot(uuid,jsonb,boolean) to service_role;

create or replace function public.marketing_dneskai_admit(p_owner uuid,p_project uuid,p_date date,p_sources jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;s jsonb;idx integer;today date:=(clock_timestamp() at time zone 'Europe/Prague')::date;
begin
 if exists(select 1 from marketing_private.dneskai_collection_pilots where user_id=p_owner and clock_timestamp()<expires_at) then raise exception 'collection pilot explicit scope required';end if;
 if not exists(select 1 from public.projects where id=p_project and user_id=p_owner and (portfolio_key='aifirst' or (portfolio_key is null and parent_id is null and (lower(repo_full_name)='lukaskourilcz/aifirst' or exists(select 1 from unnest(previous_repo_full_names) name where lower(name)='lukaskourilcz/aifirst'))))) then raise exception 'collection project unavailable';end if;
 -- Ordinary admission never adopts the retained pilot run, mirroring the pilot side's existing-run check.
 select * into r from public.marketing_dneskai_runs where user_id=p_owner and project_id=p_project and date=p_date;
 if found then if r.collection_pilot_owner is not null then raise exception 'collection pilot existing daily run';end if;return to_jsonb(r);end if;
 if p_date is distinct from today or to_char(clock_timestamp() at time zone 'Europe/Prague','HH24:MI')<'22:00' or jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 42 then raise exception 'collection admission invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_project::text||p_date::text||'dneskai-admit',0));
 select * into r from public.marketing_dneskai_runs where user_id=p_owner and project_id=p_project and date=p_date;
 if found then if r.collection_pilot_owner is not null then raise exception 'collection pilot existing daily run';end if;return to_jsonb(r);end if;
 insert into public.marketing_dneskai_runs(user_id,project_id,date,target_date,cost_usd) values(p_owner,p_project,p_date,p_date+1,0) returning * into r;
 for s in select value from jsonb_array_elements(p_sources) loop
  if s->>'id' is null or s->>'kind' is null or (s->>'maxItems')::int not between 1 and 20 then raise exception 'collection source invalid';end if;
  insert into public.marketing_dneskai_stages(user_id,run_id,source_id,kind,since_at,max_items) values(p_owner,r.id,s->>'id',case when s->>'kind'='instagram' then 'instagram' else 'feed' end,coalesce((select last_success_at-interval '5 minutes' from public.marketing_dneskai_source_states where user_id=p_owner and project_id=p_project and source_id=s->>'id'),r.created_at-interval '7 days'),(s->>'maxItems')::int);
 end loop;
 for idx in 0..15 loop insert into public.marketing_dneskai_stages(user_id,run_id,source_id,kind,since_at,max_items) values(p_owner,r.id,'__jev:'||lpad(idx::text,2,'0'),'jev',r.created_at-interval '30 days',8);end loop;
 return to_jsonb(r);
end $$;

create or replace function public.marketing_dneskai_claim_stage(p_owner uuid,p_run uuid,p_fence uuid,p_source text,p_paid boolean) returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;s public.marketing_dneskai_stages;total numeric;items integer;amount numeric;
begin
 select * into r from public.marketing_dneskai_runs where id=p_run and user_id=p_owner and fence=p_fence and lease_until>clock_timestamp() and status='running' for update;if not found then raise exception 'collection fence unavailable';end if;
 select * into s from public.marketing_dneskai_stages where run_id=p_run and source_id=p_source and user_id=p_owner for update;if not found or s.status not in('queued','polling') then return null;end if;
 if p_paid then
  if r.date is distinct from (clock_timestamp() at time zone 'Europe/Prague')::date then raise exception 'collection day expired';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-paid-serial',0));
  if exists(select 1 from public.marketing_dneskai_stages where user_id=p_owner and reserved_usd>0 and (cost_usd is null or cost_usd>reserved_usd)) then raise exception 'collection cost unresolved';end if;
  if s.status<>'queued' or s.kind='feed' or s.reserved_usd<>0 then raise exception 'paid attempt unavailable';end if;
  -- A pilot run keeps its immutable window and one-run limit. An ordinary run is held only while a
  -- generation or collection pilot window is unexpired; an expired ledger row no longer blocks it.
  if r.collection_pilot_owner is not null then
   perform marketing_private.check_dneskai_collection_pilot(p_owner,r.project_id);
   if not exists(select 1 from marketing_private.dneskai_collection_pilots where user_id=p_owner and run_id=p_run) then raise exception 'collection pilot run mismatch';end if;
  elsif exists(select 1 from marketing_private.generation_pilots where user_id=p_owner and clock_timestamp()<expires_at) or exists(select 1 from marketing_private.dneskai_collection_pilots where user_id=p_owner and clock_timestamp()<expires_at) then raise exception 'collection paid pilot blocked';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||r.date::text||'dneskai-budget',0));
  if r.date is distinct from (clock_timestamp() at time zone 'Europe/Prague')::date then raise exception 'collection day expired';end if;
  select coalesce(sum(st.reserved_usd),0),coalesce(sum(st.reserved_items),0) into total,items from public.marketing_dneskai_stages st join public.marketing_dneskai_runs ru on ru.id=st.run_id where ru.user_id=p_owner and ru.date=r.date;
  amount:=case when s.kind='instagram' then 0.04 else 0.003 end;
  if r.collection_pilot_owner is not null then
   perform marketing_private.check_dneskai_collection_pilot(p_owner,r.project_id);
   if (select coalesce(sum(st.reserved_usd),0) from public.marketing_dneskai_stages st where st.run_id=p_run)+amount>0.24 then raise exception 'collection pilot budget exceeded';end if;
  end if;
  if total+amount>0.25 or (s.kind='instagram' and (s.max_items>7 or items+s.max_items>35)) then raise exception 'collection daily budget exceeded';end if;
  update public.marketing_dneskai_stages set reserved_usd=amount,reserved_items=case when s.kind='instagram' then max_items else 0 end where run_id=p_run and source_id=p_source;
 end if;
 update public.marketing_dneskai_stages set status='running' where run_id=p_run and source_id=p_source returning * into s;return to_jsonb(s);
end $$;
