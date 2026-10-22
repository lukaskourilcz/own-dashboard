-- Research collection only. No revision, approval, calendar activation or publication authority.
alter table public.user_preferences drop constraint if exists user_preferences_hidden_project_tabs_check;
alter table public.user_preferences add constraint user_preferences_hidden_project_tabs_check check(hidden_project_tabs <@ array['overview','tasks','activity','communication','repository','finance','competition','knowledge','sources','scaling','monetization']::text[]);
create table public.marketing_dneskai_runs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,project_id uuid not null references public.projects(id) on delete cascade,
 date date not null,target_date date not null,status text not null default 'running' check(status in('running','complete','partial','held','failed')),
 tick_count integer not null default 0 check(tick_count between 0 and 40),fence uuid,lease_until timestamptz,
 selected_count integer not null default 0 check(selected_count between 0 and 4),cost_usd numeric check(cost_usd>=0),error_code text,
 created_at timestamptz not null default clock_timestamp(),unique(user_id,project_id,date),check(target_date=date+1)
);
create table public.marketing_dneskai_stages (
 user_id uuid not null references auth.users(id) on delete cascade,run_id uuid not null references public.marketing_dneskai_runs(id) on delete cascade,source_id text not null,
 kind text not null check(kind in('feed','instagram','jev')),status text not null default 'queued' check(status in('queued','running','polling','ok','partial','error','held')),
 since_at timestamptz not null,max_items integer not null check(max_items between 1 and 20),reserved_usd numeric not null default 0 check(reserved_usd between 0 and 0.05),reserved_items integer not null default 0 check(reserved_items between 0 and 7),
 registration jsonb,cost_usd numeric check(cost_usd>=0),error_code text,primary key(run_id,source_id)
);
create table public.marketing_dneskai_source_states (
 user_id uuid not null references auth.users(id) on delete cascade,project_id uuid not null references public.projects(id) on delete cascade,source_id text not null,
 last_success_at timestamptz,last_attempt_at timestamptz,status text not null check(status in('never','ok','partial','error','held')),
 error_code text,item_count integer not null default 0 check(item_count>=0),cost_usd numeric check(cost_usd>=0),primary key(user_id,project_id,source_id)
);
create table public.marketing_dneskai_candidates (
 id text not null,user_id uuid not null references auth.users(id) on delete cascade,project_id uuid not null references public.projects(id) on delete cascade,run_id uuid not null references public.marketing_dneskai_runs(id),
 candidate jsonb not null,canonical_url_hash text not null,normalized_text_hash text not null,content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),status text not null check(status in('new','held','duplicate','rejected','selected')),
 target_date date,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(user_id,project_id,id),unique(user_id,project_id,content_hash),unique(user_id,project_id,canonical_url_hash),unique(user_id,project_id,normalized_text_hash)
);
create index dneskai_recent_candidates on public.marketing_dneskai_candidates(user_id,project_id,updated_at desc);
create index dneskai_owner_stages on public.marketing_dneskai_stages(user_id,run_id);
create index dneskai_daily_budget on public.marketing_dneskai_runs(user_id,date);
create function public.marketing_dneskai_ownership() returns trigger language plpgsql set search_path='' as $$
begin
 if to_jsonb(new)?'project_id' and not exists(select 1 from public.projects where id=(to_jsonb(new)->>'project_id')::uuid and user_id=new.user_id) then raise exception 'foreign collection project';end if;
 if to_jsonb(new)?'run_id' and not exists(select 1 from public.marketing_dneskai_runs where id=(to_jsonb(new)->>'run_id')::uuid and user_id=new.user_id and (not(to_jsonb(new)?'project_id') or project_id=(to_jsonb(new)->>'project_id')::uuid)) then raise exception 'foreign collection run';end if;
 return new;
end $$;
revoke all on function public.marketing_dneskai_ownership() from public,anon,authenticated;
do $$ declare t text;begin foreach t in array array['marketing_dneskai_runs','marketing_dneskai_stages','marketing_dneskai_source_states','marketing_dneskai_candidates'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
 execute format('create trigger collection_ownership before insert or update on public.%I for each row execute function public.marketing_dneskai_ownership()',t);
 end loop;end $$;
create function public.marketing_dneskai_admit(p_owner uuid,p_project uuid,p_date date,p_sources jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;s jsonb;idx integer;today date:=(clock_timestamp() at time zone 'Europe/Prague')::date;
begin
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
create function public.marketing_dneskai_claim(p_owner uuid,p_run uuid,p_fence uuid) returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;
begin
 select * into r from public.marketing_dneskai_runs where id=p_run and user_id=p_owner for update;if not found then return null;end if;
 if r.status<>'running' or (r.lease_until>clock_timestamp()) then return to_jsonb(r);end if;
 if r.tick_count>=40 then update public.marketing_dneskai_runs set status='held',error_code='collection-tick-limit',lease_until=null where id=p_run returning * into r;return to_jsonb(r);end if;
 -- A lost invocation never starts an ambiguous paid stage again.
 update public.marketing_dneskai_stages set status='held',error_code='collection-stage-lease-lost' where run_id=p_run and status='running';
 update public.marketing_dneskai_runs set fence=p_fence,lease_until=clock_timestamp()+interval '60 seconds',tick_count=tick_count+1 where id=p_run returning * into r;return to_jsonb(r);
end $$;
create function public.marketing_dneskai_claim_stage(p_owner uuid,p_run uuid,p_fence uuid,p_source text,p_paid boolean) returns jsonb language plpgsql set search_path='' as $$
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
  if exists(select 1 from marketing_private.generation_pilots where user_id=p_owner) then raise exception 'collection paid pilot blocked';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||r.date::text||'dneskai-budget',0));
  if r.date is distinct from (clock_timestamp() at time zone 'Europe/Prague')::date then raise exception 'collection day expired';end if;
  select coalesce(sum(st.reserved_usd),0),coalesce(sum(st.reserved_items),0) into total,items from public.marketing_dneskai_stages st join public.marketing_dneskai_runs ru on ru.id=st.run_id where ru.user_id=p_owner and ru.date=r.date;
  amount:=case when s.kind='instagram' then 0.04 else 0.003 end;
  if total+amount>0.25 or (s.kind='instagram' and (s.max_items>7 or items+s.max_items>35)) then raise exception 'collection daily budget exceeded';end if;
  update public.marketing_dneskai_stages set reserved_usd=amount,reserved_items=case when s.kind='instagram' then max_items else 0 end where run_id=p_run and source_id=p_source;
 end if;
 update public.marketing_dneskai_stages set status='running' where run_id=p_run and source_id=p_source returning * into s;return to_jsonb(s);
end $$;
create function public.marketing_dneskai_save_stage(p_owner uuid,p_run uuid,p_fence uuid,p_source text,p_result jsonb) returns void language plpgsql set search_path='' as $$
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
   if item->>'status' not in('new','held','duplicate','rejected') or (existing.candidate-array['category','relevance','duplicateOf','{status}','{reason}','targetDate']) is distinct from (item-array['category','relevance','duplicateOf','{status}','{reason}','{targetDate}','canonicalUrlHash','normalizedTextHash']) then raise exception 'classification changed source';end if;
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
create function public.marketing_dneskai_finish(p_owner uuid,p_run uuid,p_fence uuid,p_status text,p_error text) returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;total numeric;unknown_cost boolean;
begin
 select * into r from public.marketing_dneskai_runs where id=p_run and user_id=p_owner and fence=p_fence and lease_until>clock_timestamp() for update;if not found then raise exception 'collection fence unavailable';end if;
 if p_status not in('running','complete','partial','held','failed') then raise exception 'collection status invalid';end if;
 select coalesce(sum(cost_usd),0),coalesce(bool_or(reserved_usd>0 and cost_usd is null),false) into total,unknown_cost from public.marketing_dneskai_stages where run_id=p_run;
 if p_status<>'running' and not unknown_cost and r.date=(clock_timestamp() at time zone 'Europe/Prague')::date then
  with eligible as (
   select id,candidate, row_number() over(partition by candidate->>'category' order by (candidate->>'relevance')::numeric desc,(candidate->>'publishedAt')::timestamptz desc,id) as category_rank
   from public.marketing_dneskai_candidates where user_id=p_owner and project_id=r.project_id and status='new' and candidate->>'category' is not null and candidate->>'category'<>'other' and (candidate->>'relevance')::numeric>=0.85 and candidate->>'duplicateOf' is null and candidate->>'reason' is null and candidate->>'publishedAt' is not null
    and (candidate->>'publishedAt')::timestamptz<=clock_timestamp()
    and (candidate->>'publishedAt')::timestamptz>=clock_timestamp()-case when candidate->>'category' in('ai-news','tech-news') then interval '48 hours' else interval '30 days' end
  ), chosen as (select id from eligible order by category_rank,(candidate->>'relevance')::numeric desc,(candidate->>'publishedAt')::timestamptz desc,id limit 4)
  update public.marketing_dneskai_candidates set status='selected',target_date=r.target_date,candidate=jsonb_set(jsonb_set(jsonb_set(candidate,'{status}','"selected"'),'{targetDate}',to_jsonb(r.target_date::text)),'{reason}','"research-selection-not-fact-checked"') where user_id=p_owner and project_id=r.project_id and id in(select id from chosen);
  update public.marketing_dneskai_candidates set updated_at=clock_timestamp() where user_id=p_owner and project_id=r.project_id and target_date=r.target_date and status='selected';
  update public.marketing_dneskai_candidates set status='held',candidate=jsonb_set(jsonb_set(candidate,'{status}','"held"'),'{reason}','"collection-source-date-unavailable-or-stale"') where user_id=p_owner and project_id=r.project_id and status='new' and (candidate->>'publishedAt' is null or (candidate->>'publishedAt')::timestamptz<clock_timestamp()-case when candidate->>'category' in('ai-news','tech-news') then interval '48 hours' else interval '30 days' end);
 end if;
 update public.marketing_dneskai_runs set status=p_status,error_code=p_error,selected_count=(select count(*) from public.marketing_dneskai_candidates where user_id=p_owner and project_id=r.project_id and status='selected' and target_date=r.target_date),cost_usd=case when unknown_cost then null else total end,lease_until=null where id=p_run returning * into r;return to_jsonb(r);
end $$;
revoke all on function public.marketing_dneskai_admit(uuid,uuid,date,jsonb),public.marketing_dneskai_claim(uuid,uuid,uuid),public.marketing_dneskai_claim_stage(uuid,uuid,uuid,text,boolean),public.marketing_dneskai_save_stage(uuid,uuid,uuid,text,jsonb),public.marketing_dneskai_finish(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_admit(uuid,uuid,date,jsonb),public.marketing_dneskai_claim(uuid,uuid,uuid),public.marketing_dneskai_claim_stage(uuid,uuid,uuid,text,boolean),public.marketing_dneskai_save_stage(uuid,uuid,uuid,text,jsonb),public.marketing_dneskai_finish(uuid,uuid,uuid,text,text) to service_role;
