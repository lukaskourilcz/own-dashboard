-- Independent Preview collection authorization only. Original generation pilots/reservations are untouched.
create table marketing_private.dneskai_collection_pilots(
 user_id uuid primary key references auth.users(id),project_id uuid not null references public.projects(id),
 starts_at timestamptz not null,expires_at timestamptz not null,
 run_id uuid unique,check(expires_at>starts_at and expires_at<=starts_at+interval '48 hours')
);
alter table marketing_private.dneskai_collection_pilots enable row level security;
revoke all on marketing_private.dneskai_collection_pilots from public,anon,authenticated;
grant select,insert,update on marketing_private.dneskai_collection_pilots to service_role;
alter table public.marketing_dneskai_runs add column collection_pilot_owner uuid references marketing_private.dneskai_collection_pilots(user_id);
alter table public.marketing_dneskai_runs add constraint collection_pilot_owner_bound check(collection_pilot_owner is null or collection_pilot_owner=user_id);
create unique index dneskai_one_lifetime_pilot_run on public.marketing_dneskai_runs(collection_pilot_owner) where collection_pilot_owner is not null;
create function marketing_private.dneskai_collection_pilot_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or new.user_id is distinct from old.user_id or new.project_id is distinct from old.project_id or new.starts_at is distinct from old.starts_at or new.expires_at is distinct from old.expires_at or (old.run_id is not null and new.run_id is distinct from old.run_id) then raise exception 'collection pilot immutable';end if;return new;
end $$;
create trigger immutable_collection_pilot before update or delete on marketing_private.dneskai_collection_pilots for each row execute function marketing_private.dneskai_collection_pilot_immutable();
create function marketing_private.check_dneskai_collection_pilot(p_owner uuid,p_project uuid,p_tuple jsonb default null) returns void language plpgsql set search_path='' as $$
declare p marketing_private.dneskai_collection_pilots;begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-paid-serial',0));
 if p_tuple is not null then
  if jsonb_typeof(p_tuple) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_tuple))<>4 or p_tuple->>'ownerId' is distinct from p_owner::text or p_tuple->>'projectId' is distinct from p_project::text or p_tuple->>'startsAt' is null or p_tuple->>'expiresAt' is null then raise exception 'collection pilot invalid';end if;
  insert into marketing_private.dneskai_collection_pilots(user_id,project_id,starts_at,expires_at) values(p_owner,p_project,(p_tuple->>'startsAt')::timestamptz,(p_tuple->>'expiresAt')::timestamptz) on conflict(user_id) do nothing;
 end if;
 select * into p from marketing_private.dneskai_collection_pilots where user_id=p_owner for update;
 if not found or p.project_id is distinct from p_project or (p_tuple is not null and (p.starts_at is distinct from (p_tuple->>'startsAt')::timestamptz or p.expires_at is distinct from (p_tuple->>'expiresAt')::timestamptz)) then raise exception 'collection pilot mismatch';end if;
 if clock_timestamp()<p.starts_at or clock_timestamp()>=p.expires_at then raise exception 'collection pilot expired';end if;
end $$;
revoke all on function marketing_private.dneskai_collection_pilot_immutable(),marketing_private.check_dneskai_collection_pilot(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function marketing_private.check_dneskai_collection_pilot(uuid,uuid,jsonb) to service_role;
create or replace function public.marketing_dneskai_admit(p_owner uuid,p_project uuid,p_date date,p_sources jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;s jsonb;idx integer;today date:=(clock_timestamp() at time zone 'Europe/Prague')::date;
begin
 if exists(select 1 from marketing_private.dneskai_collection_pilots where user_id=p_owner) then raise exception 'collection pilot explicit scope required';end if;
 if not exists(select 1 from public.projects where id=p_project and user_id=p_owner and (portfolio_key='aifirst' or (portfolio_key is null and parent_id is null and (lower(repo_full_name)='lukaskourilcz/aifirst' or exists(select 1 from unnest(previous_repo_full_names) name where lower(name)='lukaskourilcz/aifirst'))))) then raise exception 'collection project unavailable';end if;
 select * into r from public.marketing_dneskai_runs where user_id=p_owner and project_id=p_project and date=p_date;
 if found then return to_jsonb(r);end if;
 if p_date is distinct from today or to_char(clock_timestamp() at time zone 'Europe/Prague','HH24:MI')<'22:00' or jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 42 then raise exception 'collection admission invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_project::text||p_date::text||'dneskai-admit',0));
 select * into r from public.marketing_dneskai_runs where user_id=p_owner and project_id=p_project and date=p_date;
 if found then return to_jsonb(r);end if;
 insert into public.marketing_dneskai_runs(user_id,project_id,date,target_date,cost_usd) values(p_owner,p_project,p_date,p_date+1,0) returning * into r;
 for s in select value from jsonb_array_elements(p_sources) loop
  if s->>'id' is null or s->>'kind' is null or (s->>'maxItems')::int not between 1 and 20 then raise exception 'collection source invalid';end if;
  insert into public.marketing_dneskai_stages(user_id,run_id,source_id,kind,since_at,max_items) values(p_owner,r.id,s->>'id',case when s->>'kind'='instagram' then 'instagram' else 'feed' end,coalesce((select last_success_at-interval '5 minutes' from public.marketing_dneskai_source_states where user_id=p_owner and project_id=p_project and source_id=s->>'id'),r.created_at-interval '7 days'),(s->>'maxItems')::int);
 end loop;
 for idx in 0..15 loop insert into public.marketing_dneskai_stages(user_id,run_id,source_id,kind,since_at,max_items) values(p_owner,r.id,'__jev:'||lpad(idx::text,2,'0'),'jev',r.created_at-interval '30 days',8);end loop;
 return to_jsonb(r);
end $$;
create function public.marketing_dneskai_admit_pilot(p_owner uuid,p_project uuid,p_date date,p_sources jsonb,p_pilot jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;s jsonb;idx integer;today date:=(clock_timestamp() at time zone 'Europe/Prague')::date;
begin
 if not exists(select 1 from public.projects where id=p_project and user_id=p_owner and (portfolio_key='aifirst' or (portfolio_key is null and parent_id is null and (lower(repo_full_name)='lukaskourilcz/aifirst' or exists(select 1 from unnest(previous_repo_full_names) name where lower(name)='lukaskourilcz/aifirst'))))) then raise exception 'collection project unavailable';end if;
 perform marketing_private.check_dneskai_collection_pilot(p_owner,p_project,p_pilot);
 select * into r from public.marketing_dneskai_runs where user_id=p_owner and project_id=p_project and date=p_date;
 if found then if r.collection_pilot_owner is distinct from p_owner then raise exception 'collection pilot existing daily run';end if;return to_jsonb(r);end if;
 if p_date is distinct from today or jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 42 then raise exception 'collection admission invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_project::text||p_date::text||'dneskai-admit',0));
 select * into r from public.marketing_dneskai_runs where user_id=p_owner and project_id=p_project and date=p_date;
 if found then if r.collection_pilot_owner is distinct from p_owner then raise exception 'collection pilot existing daily run';end if;return to_jsonb(r);end if;
 if exists(select 1 from marketing_private.dneskai_collection_pilots where user_id=p_owner and run_id is not null) then raise exception 'collection pilot run limit';end if;
 perform marketing_private.check_dneskai_collection_pilot(p_owner,p_project,p_pilot);
 insert into public.marketing_dneskai_runs(user_id,project_id,date,target_date,cost_usd,collection_pilot_owner) values(p_owner,p_project,p_date,p_date+1,0,p_owner) returning * into r;
 update marketing_private.dneskai_collection_pilots set run_id=r.id where user_id=p_owner;
 for s in select value from jsonb_array_elements(p_sources) loop
  if s->>'id' is null or s->>'kind' is null or (s->>'maxItems')::int not between 1 and 20 then raise exception 'collection source invalid';end if;
  insert into public.marketing_dneskai_stages(user_id,run_id,source_id,kind,since_at,max_items) values(p_owner,r.id,s->>'id',case when s->>'kind'='instagram' then 'instagram' else 'feed' end,coalesce((select last_success_at-interval '5 minutes' from public.marketing_dneskai_source_states where user_id=p_owner and project_id=p_project and source_id=s->>'id'),r.created_at-interval '7 days'),(s->>'maxItems')::int);
 end loop;
 for idx in 0..15 loop insert into public.marketing_dneskai_stages(user_id,run_id,source_id,kind,since_at,max_items) values(p_owner,r.id,'__jev:'||lpad(idx::text,2,'0'),'jev',r.created_at-interval '30 days',8);end loop;
 return to_jsonb(r);
end $$;
create or replace function public.marketing_dneskai_claim(p_owner uuid,p_run uuid,p_fence uuid) returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;
begin
 select * into r from public.marketing_dneskai_runs where id=p_run and user_id=p_owner for update;if not found then return null;end if;
 if r.collection_pilot_owner is not null then perform marketing_private.check_dneskai_collection_pilot(p_owner,r.project_id);end if;
 if r.status<>'running' or (r.lease_until>clock_timestamp()) then return to_jsonb(r);end if;
 if r.tick_count>=40 then update public.marketing_dneskai_runs set status='held',error_code='collection-tick-limit',lease_until=null where id=p_run returning * into r;return to_jsonb(r);end if;
 -- A lost invocation never starts an ambiguous paid stage again.
 update public.marketing_dneskai_stages set status='held',error_code='collection-stage-lease-lost' where run_id=p_run and status='running';
 update public.marketing_dneskai_runs set fence=p_fence,lease_until=least(clock_timestamp()+interval '60 seconds',coalesce((select expires_at from marketing_private.dneskai_collection_pilots where user_id=r.collection_pilot_owner),'infinity'::timestamptz)),tick_count=tick_count+1 where id=p_run returning * into r;return to_jsonb(r);
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
  -- Existing pilot is immutable: no collection allowance is added by deleting env settings or failing a run.
  if r.collection_pilot_owner is not null then
   perform marketing_private.check_dneskai_collection_pilot(p_owner,r.project_id);
   if not exists(select 1 from marketing_private.dneskai_collection_pilots where user_id=p_owner and run_id=p_run) then raise exception 'collection pilot run mismatch';end if;
  elsif exists(select 1 from marketing_private.generation_pilots where user_id=p_owner) or exists(select 1 from marketing_private.dneskai_collection_pilots where user_id=p_owner) then raise exception 'collection paid pilot blocked';end if;
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

revoke all on function public.marketing_dneskai_admit_pilot(uuid,uuid,date,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_admit_pilot(uuid,uuid,date,jsonb,jsonb) to service_role;

-- Classification may change only these top-level derived fields, never authored surfaces.
create or replace function public.marketing_dneskai_save_stage(p_owner uuid,p_run uuid,p_fence uuid,p_source text,p_result jsonb) returns void language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;s public.marketing_dneskai_stages;item jsonb;new_status text;measured numeric;existing public.marketing_dneskai_candidates;selected integer:=0;
begin
 select * into r from public.marketing_dneskai_runs where id=p_run and user_id=p_owner and fence=p_fence and lease_until>clock_timestamp() and status='running' for update;if not found then raise exception 'collection fence unavailable';end if;
 select * into s from public.marketing_dneskai_stages where run_id=p_run and source_id=p_source and user_id=p_owner for update;if not found or s.status<>'running' then raise exception 'collection stage unavailable';end if;
 new_status:=p_result->>'status';measured:=(p_result->>'costUsd')::numeric;
 if new_status is null or new_status not in('polling','ok','partial','error','held') or jsonb_typeof(p_result->'items') is distinct from 'array' or jsonb_array_length(p_result->'items')>s.max_items or (measured is not null and measured<0) then raise exception 'collection result invalid';end if;
 if measured>s.reserved_usd then new_status:='held';p_result:=jsonb_set(p_result,'{errorCode}','"collection-budget-exceeded"');end if;
 for item in select value from jsonb_array_elements(p_result->'items') loop
  if item->>'id' is null or item->>'canonicalUrlHash' is null or item->>'normalizedTextHash' is null or item->>'contentHash' is null or item->>'contentHash' !~ '^[a-f0-9]{64}$' or (s.kind<>'jev' and item->>'sourceId' is distinct from p_source) then raise exception 'collection candidate invalid';end if;
  select * into existing from public.marketing_dneskai_candidates where user_id=p_owner and project_id=r.project_id and (id=item->>'id' or content_hash=item->>'contentHash' or canonical_url_hash=item->>'canonicalUrlHash' or normalized_text_hash=item->>'normalizedTextHash') limit 1;
  if s.kind='jev' then
   if not found then continue;end if;
   if item->>'status' not in('new','held','duplicate','rejected') or (existing.candidate-array['category','relevance','duplicateOf','status','reason','targetDate']) is distinct from (item-array['category','relevance','duplicateOf','status','reason','targetDate','canonicalUrlHash','normalizedTextHash']) then raise exception 'classification changed source';end if;
   if not found or existing.status<>'new' or existing.content_hash<>item->>'contentHash' then continue;end if;
   if new_status<>'ok' or measured is null or measured>s.reserved_usd then item:=jsonb_set(jsonb_set(item,'{status}','"held"'),'{reason}','"collection-cost-unverified"');end if;
   item:=item-'canonicalUrlHash'-'normalizedTextHash';
   update public.marketing_dneskai_candidates set candidate=item,status=item->>'status',target_date=case when item->>'status'='selected' then r.target_date else null end,updated_at=clock_timestamp() where user_id=p_owner and project_id=r.project_id and id=existing.id;
  elsif not found then
   item:=jsonb_set(jsonb_set(item,'{status}',case when item->>'publishedAt' is null or btrim(coalesce(item->>'title','')||coalesce(item->>'text',''))='' then '"held"'::jsonb else '"new"'::jsonb end),'{targetDate}','null');
   insert into public.marketing_dneskai_candidates(id,user_id,project_id,run_id,candidate,canonical_url_hash,normalized_text_hash,content_hash,status) values(item->>'id',p_owner,r.project_id,p_run,item-'canonicalUrlHash'-'normalizedTextHash',item->>'canonicalUrlHash',item->>'normalizedTextHash',item->>'contentHash',item->>'status') on conflict do nothing;
  end if;
 end loop;

 update public.marketing_dneskai_stages set status=new_status,cost_usd=measured,error_code=p_result->>'errorCode',registration=coalesce(p_result->'registration',registration) where run_id=p_run and source_id=p_source;
 if s.kind<>'jev' then
  insert into public.marketing_dneskai_source_states(user_id,project_id,source_id,last_success_at,last_attempt_at,status,error_code,item_count,cost_usd)
  values(p_owner,r.project_id,p_source,case when new_status='ok' and p_result->>'complete'='true' and jsonb_array_length(p_result->'items')<s.max_items then r.created_at else null end,clock_timestamp(),case when new_status='polling' then 'held' else new_status end,p_result->>'errorCode',jsonb_array_length(p_result->'items'),measured)
  on conflict(user_id,project_id,source_id) do update set last_success_at=greatest(excluded.last_success_at,marketing_dneskai_source_states.last_success_at),last_attempt_at=excluded.last_attempt_at,status=excluded.status,error_code=excluded.error_code,item_count=excluded.item_count,cost_usd=excluded.cost_usd;
 end if;
end $$;
