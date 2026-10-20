-- One tick endpoint for every scheduled marketing duty (#120, owner decision 4 of #110: pg_cron in
-- Supabase calls POST /api/marketing/tick; n8n keeps no timer).
--
-- marketing_ticks is the measurement: one row per accepted tick with what each category did and
-- which failed. Its primary key is the tick id the caller sends, so a replayed or retried tick is
-- recognised and does nothing. The scheduler keeps 14 days of rows.
--
-- marketing_scheduler_state holds one lease per category, so two concurrent ticks never run the
-- same category at once, plus the next time a category may run again (media backoff, collection
-- retryAfterSeconds) and a small state object (the brief run already handled, jobs that cannot be
-- claimed, Instagram refreshes that must not be retried).
--
-- Both tables are own-only: the owner reads them, only service_role writes, through the functions
-- below. Neither table ever holds a secret, token, source text or URL.

create table public.marketing_ticks (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check (kind in ('minute','daily')),
 started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 did jsonb not null default '[]'::jsonb check (jsonb_typeof(did)='array' and jsonb_array_length(did)<=20 and pg_column_size(did)<=16384),
 errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors)='array' and jsonb_array_length(errors)<=20 and pg_column_size(errors)<=8192),
 check (finished_at is null or finished_at>=started_at)
);
create index marketing_ticks_recent on public.marketing_ticks(user_id,started_at desc);
alter table public.marketing_ticks enable row level security;
revoke all on public.marketing_ticks from public,anon,authenticated;
grant select on public.marketing_ticks to authenticated;
grant select,insert,update,delete on public.marketing_ticks to service_role;
create policy owner_read on public.marketing_ticks for select to authenticated using ((select auth.uid())=user_id);

create table public.marketing_scheduler_state (
 user_id uuid not null references auth.users(id) on delete cascade,
 category text not null check (category in ('collection','media','briefs','generation','publishing','reconciliation','token','renewal')),
 holder uuid,
 lease_until timestamptz,
 next_allowed_at timestamptz,
 state jsonb not null default '{}'::jsonb check (jsonb_typeof(state)='object' and pg_column_size(state)<=8192),
 updated_at timestamptz not null default clock_timestamp(),
 primary key (user_id,category),
 check ((holder is null)=(lease_until is null))
);
alter table public.marketing_scheduler_state enable row level security;
revoke all on public.marketing_scheduler_state from public,anon,authenticated;
grant select on public.marketing_scheduler_state to authenticated;
grant select,insert,update,delete on public.marketing_scheduler_state to service_role;
create policy owner_read on public.marketing_scheduler_state for select to authenticated using ((select auth.uid())=user_id);

-- Records an accepted tick. False means this tick id was seen before: the caller does nothing.
create function public.marketing_scheduler_begin_tick(p_owner uuid,p_tick uuid,p_kind text) returns boolean
language plpgsql set search_path='' as $$
begin
 if p_owner is null or p_tick is null or p_kind is null or p_kind not in ('minute','daily') then raise exception 'tick input invalid'; end if;
 insert into public.marketing_ticks(id,user_id,kind) values(p_tick,p_owner,p_kind) on conflict (id) do nothing;
 return found;
end $$;

create function public.marketing_scheduler_finish_tick(p_owner uuid,p_tick uuid,p_did jsonb,p_errors jsonb) returns boolean
language plpgsql set search_path='' as $$
begin
 if p_owner is null or p_tick is null or jsonb_typeof(p_did) is distinct from 'array' or jsonb_typeof(p_errors) is distinct from 'array' then raise exception 'tick result invalid'; end if;
 update public.marketing_ticks set finished_at=clock_timestamp(),did=p_did,errors=p_errors where id=p_tick and user_id=p_owner and finished_at is null;
 return found;
end $$;

-- Takes the lease of one category for p_seconds. A live lease of another holder answers 'busy'; a
-- next_allowed_at in the future answers 'backoff'. The same holder may take its own lease again.
create function public.marketing_scheduler_acquire(p_owner uuid,p_category text,p_holder uuid,p_seconds integer) returns jsonb
language plpgsql set search_path='' as $$
declare s public.marketing_scheduler_state;
begin
 if p_owner is null or p_holder is null or p_seconds is null or p_seconds not between 1 and 300
  or p_category is null or p_category not in ('collection','media','briefs','generation','publishing','reconciliation','token','renewal') then raise exception 'lease input invalid'; end if;
 insert into public.marketing_scheduler_state(user_id,category) values(p_owner,p_category) on conflict (user_id,category) do nothing;
 select * into s from public.marketing_scheduler_state where user_id=p_owner and category=p_category for update;
 if s.lease_until>clock_timestamp() and s.holder is distinct from p_holder then
  return jsonb_build_object('acquired',false,'reason','busy','until',s.lease_until);
 end if;
 if s.next_allowed_at>clock_timestamp() then
  return jsonb_build_object('acquired',false,'reason','backoff','until',s.next_allowed_at);
 end if;
 update public.marketing_scheduler_state set holder=p_holder,lease_until=clock_timestamp()+make_interval(secs=>p_seconds),updated_at=clock_timestamp()
  where user_id=p_owner and category=p_category returning * into s;
 return jsonb_build_object('acquired',true,'until',s.lease_until,'state',s.state);
end $$;

-- Ends a lease the caller still holds, sets the next allowed time (null clears it) and, when given,
-- replaces the category's state. A lease that expired and was taken by another tick is not touched.
create function public.marketing_scheduler_release(p_owner uuid,p_category text,p_holder uuid,p_next_allowed_at timestamptz,p_state jsonb) returns boolean
language plpgsql set search_path='' as $$
begin
 if p_owner is null or p_category is null or p_holder is null then raise exception 'lease input invalid'; end if;
 if p_state is not null and jsonb_typeof(p_state) is distinct from 'object' then raise exception 'lease state invalid'; end if;
 if p_next_allowed_at is not null and p_next_allowed_at>clock_timestamp()+interval '2 days' then raise exception 'lease backoff invalid'; end if;
 update public.marketing_scheduler_state set holder=null,lease_until=null,next_allowed_at=p_next_allowed_at,state=coalesce(p_state,state),updated_at=clock_timestamp()
  where user_id=p_owner and category=p_category and holder=p_holder;
 return found;
end $$;

-- Replaces the state of a category while the caller still holds its live lease, without ending it.
-- The token step stores "this refresh may be in flight" here before it sends the request, so a lost
-- answer is never retried even when the release afterwards fails.
create function public.marketing_scheduler_save_state(p_owner uuid,p_category text,p_holder uuid,p_state jsonb) returns boolean
language plpgsql set search_path='' as $$
begin
 if p_owner is null or p_category is null or p_holder is null then raise exception 'lease input invalid'; end if;
 if jsonb_typeof(p_state) is distinct from 'object' then raise exception 'lease state invalid'; end if;
 update public.marketing_scheduler_state set state=p_state,updated_at=clock_timestamp()
  where user_id=p_owner and category=p_category and holder=p_holder and lease_until>clock_timestamp();
 return found;
end $$;

-- Retention for the measurement table: the daily tick removes rows older than p_days (14).
create function public.marketing_scheduler_prune_ticks(p_owner uuid,p_days integer) returns integer
language plpgsql set search_path='' as $$
declare removed integer;
begin
 if p_owner is null or p_days is null or p_days not between 1 and 365 then raise exception 'tick retention invalid'; end if;
 delete from public.marketing_ticks where user_id=p_owner and started_at<clock_timestamp()-make_interval(days=>p_days);
 get diagnostics removed=row_count;
 return removed;
end $$;

revoke all on function public.marketing_scheduler_begin_tick(uuid,uuid,text),public.marketing_scheduler_finish_tick(uuid,uuid,jsonb,jsonb),
 public.marketing_scheduler_acquire(uuid,text,uuid,integer),public.marketing_scheduler_release(uuid,text,uuid,timestamptz,jsonb),
 public.marketing_scheduler_save_state(uuid,text,uuid,jsonb),public.marketing_scheduler_prune_ticks(uuid,integer) from public,anon,authenticated;
grant execute on function public.marketing_scheduler_begin_tick(uuid,uuid,text),public.marketing_scheduler_finish_tick(uuid,uuid,jsonb,jsonb),
 public.marketing_scheduler_acquire(uuid,text,uuid,integer),public.marketing_scheduler_release(uuid,text,uuid,timestamptz,jsonb),
 public.marketing_scheduler_save_state(uuid,text,uuid,jsonb),public.marketing_scheduler_prune_ticks(uuid,integer) to service_role;
