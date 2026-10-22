-- Second half of the scheduler release (#120): production applied the tables as 20261021124400 and
-- these functions as their own version. marketing_scheduler_prune_ticks is not here; it is in
-- 20261022000000_marketing_scheduler_retention.sql, because production never received it.

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

revoke all on function public.marketing_scheduler_begin_tick(uuid,uuid,text),public.marketing_scheduler_finish_tick(uuid,uuid,jsonb,jsonb),
 public.marketing_scheduler_acquire(uuid,text,uuid,integer),public.marketing_scheduler_release(uuid,text,uuid,timestamptz,jsonb),
 public.marketing_scheduler_save_state(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_scheduler_begin_tick(uuid,uuid,text),public.marketing_scheduler_finish_tick(uuid,uuid,jsonb,jsonb),
 public.marketing_scheduler_acquire(uuid,text,uuid,integer),public.marketing_scheduler_release(uuid,text,uuid,timestamptz,jsonb),
 public.marketing_scheduler_save_state(uuid,text,uuid,jsonb) to service_role;
