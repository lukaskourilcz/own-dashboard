-- One complete rule/relationship snapshot, without PostgREST's table row cap.
-- Service callers must name their verified connection owner explicitly.
create or replace function public.transaction_rule_context(p_user_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor uuid := coalesce(p_user_id,(select auth.uid())); result jsonb;
begin
  if actor is null or (current_user = 'service_role' and p_user_id is null) or (current_user <> 'service_role' and actor is distinct from (select auth.uid())) then
    raise exception 'Owner required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'owner_id',actor,
    'rules',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from
      (select * from public.transaction_rules where user_id=actor order by id limit 1001) r),'[]'::jsonb),
    'project_ids',coalesce((select jsonb_agg(p.id order by p.id) from
      (select id from public.projects where user_id=actor order by id limit 10001) p),'[]'::jsonb),
    'subscription_ids',coalesce((select jsonb_agg(s.id order by s.id) from
      (select id from public.subscriptions where user_id=actor order by id limit 20001) s),'[]'::jsonb)
  ) into result;
  if jsonb_array_length(result->'rules')>1000 or jsonb_array_length(result->'project_ids')>10000
    or jsonb_array_length(result->'subscription_ids')>20000 or octet_length(result::text)>4194304 then
    raise exception 'Rule context exceeds the complete read bound' using errcode='54000';
  end if;
  return result || jsonb_build_object('rules_version',md5((result->'rules')::text));
end $$;

-- All direct editor writes participate in the same owner lock as retroactive
-- application, including inserts that a row-lock-only scheme would miss.
create function public.lock_transaction_rule_owner() returns trigger
language plpgsql security invoker set search_path='' as $$
declare actor uuid := case when tg_op='DELETE' then old.user_id else new.user_id end;
begin
  if tg_op='UPDATE' and old.user_id is distinct from new.user_id then
    raise exception 'Rule owner is immutable' using errcode='42501';
  end if;
  if current_user in ('anon','authenticated') and actor is distinct from (select auth.uid()) then
    raise exception 'Owner required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transaction-rules:'||actor::text,0));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger transaction_rule_owner_lock before insert or update or delete on public.transaction_rules
for each row execute function public.lock_transaction_rule_owner();
revoke all on function public.lock_transaction_rule_owner() from public,anon,authenticated,service_role;

create function public.transaction_rule_snapshot() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid := (select auth.uid()); result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select jsonb_build_object('context',public.transaction_rule_context(),
    'transactions',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (
      select t.id,t.user_id,t.note,t.account_id,t.amount,t.occurred_on,t.kind,t.category,t.project_id,t.subscription_id,
        md5(to_jsonb(t)::text) as version
      from public.transactions t where t.user_id=actor order by t.id limit 20001
    ) r),'[]'::jsonb)) into result;
  if jsonb_array_length(result->'transactions')>20000 or octet_length(result::text)>10485760 then
    raise exception 'Rule snapshot exceeds the complete read bound' using errcode='54000';
  end if;
  return result;
end $$;

create function public.apply_transaction_rule_plan(p_rules_version text,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid := (select auth.uid()); entry jsonb; changes jsonb; result jsonb; expected integer;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_rules_version is null or p_rules_version !~ '^[0-9a-f]{32}$'
    or jsonb_typeof(p_plan) is distinct from 'array' then
    raise exception 'Invalid rule plan' using errcode='22023';
  end if;
  expected := jsonb_array_length(p_plan);
  if expected>20000 or octet_length(p_plan::text)>4194304 then
    raise exception 'Rule plan exceeds the complete write bound' using errcode='54000';
  end if;
  for entry in select value from jsonb_array_elements(p_plan) loop
    if jsonb_typeof(entry) is distinct from 'object' then raise exception 'Invalid rule plan' using errcode='22023'; end if;
    if not(entry ?& array['id','version','changes']) or exists(select 1 from jsonb_object_keys(entry) k where k not in ('id','version','changes'))
      or jsonb_typeof(entry->'id') is distinct from 'string' or (entry->>'id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or jsonb_typeof(entry->'version') is distinct from 'string' or (entry->>'version') !~ '^[0-9a-f]{32}$'
      or jsonb_typeof(entry->'changes') is distinct from 'object' then
      raise exception 'Invalid rule plan' using errcode='22023';
    end if;
    changes := entry->'changes';
    if changes='{}'::jsonb or exists(select 1 from jsonb_each(changes) c where
      c.key not in ('category','note','project_id','subscription_id') or jsonb_typeof(c.value) not in ('string','null'))
      or (changes->>'project_id' is not null and (changes->>'project_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
      or (changes->>'subscription_id' is not null and (changes->>'subscription_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') then
      raise exception 'Invalid rule changes' using errcode='22023';
    end if;
  end loop;
  if (select count(distinct (p->>'id')::uuid) from jsonb_array_elements(p_plan) p)<>expected then
    raise exception 'Duplicate rule target' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transaction-rules:'||actor::text,0));
  if (public.transaction_rule_context()->>'rules_version') is distinct from p_rules_version then
    raise exception 'Rules changed' using errcode='40001';
  end if;
  -- Parent locks precede ledger locks, matching foreign-key delete order.
  perform p.id from public.projects p where p.user_id=actor and p.id in
    (select (r->'changes'->>'project_id')::uuid from jsonb_array_elements(p_plan) r) order by p.id for key share;
  perform s.id from public.subscriptions s where s.user_id=actor and s.id in
    (select (r->'changes'->>'subscription_id')::uuid from jsonb_array_elements(p_plan) r) order by s.id for key share;
  if exists(select 1 from jsonb_array_elements(p_plan) r where
    (r->'changes'->>'project_id' is not null and not exists(select 1 from public.projects p where p.id=(r->'changes'->>'project_id')::uuid and p.user_id=actor))
    or (r->'changes'->>'subscription_id' is not null and not exists(select 1 from public.subscriptions s where s.id=(r->'changes'->>'subscription_id')::uuid and s.user_id=actor))) then
    raise exception 'Rule parent changed' using errcode='40001';
  end if;
  perform t.id from public.transactions t where t.user_id=actor and t.id in
    (select (r->>'id')::uuid from jsonb_array_elements(p_plan) r) order by t.id for update;
  if (select count(*) from public.transactions t join jsonb_array_elements(p_plan) r on t.id=(r->>'id')::uuid
    where t.user_id=actor and md5(to_jsonb(t)::text)=r->>'version')<>expected then
    raise exception 'Transactions changed' using errcode='40001';
  end if;
  with changed as (
    update public.transactions t set
      category=case when r->'changes' ? 'category' then r->'changes'->>'category' else t.category end,
      note=case when r->'changes' ? 'note' then r->'changes'->>'note' else t.note end,
      project_id=case when r->'changes' ? 'project_id' then (r->'changes'->>'project_id')::uuid else t.project_id end,
      subscription_id=case when r->'changes' ? 'subscription_id' then (r->'changes'->>'subscription_id')::uuid else t.subscription_id end
    from jsonb_array_elements(p_plan) r where t.user_id=actor and t.id=(r->>'id')::uuid
    returning t.id,t.category,t.note,t.project_id,t.subscription_id
  ) select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) into result from changed c;
  if jsonb_array_length(result)<>expected or exists(
    select 1 from jsonb_array_elements(result) c join jsonb_array_elements(p_plan) r on (c->>'id')::uuid=(r->>'id')::uuid
    cross join lateral jsonb_each(r->'changes') v where c->v.key is distinct from v.value
  ) then raise exception 'Rule writes not confirmed' using errcode='40001'; end if;
  return jsonb_build_object('updated',expected,'ids',coalesce((select jsonb_agg(c->'id' order by c->>'id') from jsonb_array_elements(result) c),'[]'::jsonb));
end $$;
revoke all on function public.transaction_rule_snapshot(),public.apply_transaction_rule_plan(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.transaction_rule_snapshot(),public.apply_transaction_rule_plan(text,jsonb) to authenticated;
comment on function public.apply_transaction_rule_plan(text,jsonb) is
  'Atomic own-only metadata plan; captured rule and complete row versions, parent ownership, confirmed writes. 20000 targets/4 MiB maximum. No partial success.';
