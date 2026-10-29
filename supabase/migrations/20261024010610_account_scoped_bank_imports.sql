-- Preserve legacy bank rows and scope new identities to their local account.
-- No migration-time writes or external-id rewrites.
create function public.validate_transaction_import_rows(p_rows jsonb,p_user_id uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare actor uuid := coalesce(p_user_id,(select auth.uid())); v_row jsonb;
  account_ids uuid[]; project_ids uuid[]; subscription_ids uuid[];
begin
  if actor is null or (current_user='service_role' and p_user_id is null)
    or (current_user<>'service_role' and actor is distinct from (select auth.uid())) then
    raise exception 'Owner required' using errcode='42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>250
    or octet_length(p_rows::text)>1048576 then
    raise exception 'Invalid import batch' using errcode='22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) is distinct from 'object'
      or not(v_row ?& array['account_id','kind','amount','currency','category','note','occurred_on','external_id','variable_symbol','project_id','subscription_id'])
      or exists(select 1 from jsonb_object_keys(v_row) k where not(k=any(array[
        'account_id','kind','amount','currency','category','note','occurred_on','external_id','variable_symbol','project_id','subscription_id'])))
      or jsonb_typeof(v_row->'kind') is distinct from 'string' or v_row->>'kind' not in ('income','expense')
      or jsonb_typeof(v_row->'amount') is distinct from 'number'
      or jsonb_typeof(v_row->'currency') is distinct from 'string' or v_row->>'currency' not in ('USD','EUR','GBP','CZK','CAD')
      or jsonb_typeof(v_row->'occurred_on') is distinct from 'string' or v_row->>'occurred_on' !~ '^\d{4}-\d{2}-\d{2}$'
      or jsonb_typeof(v_row->'external_id') is distinct from 'string' or length(v_row->>'external_id') not between 1 and 512
      or exists(select 1 from unnest(array['account_id','category','note','variable_symbol','project_id','subscription_id']) k
        where jsonb_typeof(v_row->k) not in ('string','null'))
      or length(v_row->>'note')>500 or length(v_row->>'category')>1000
      or (v_row->>'variable_symbol' is not null and v_row->>'variable_symbol' !~ '^\d{1,10}$') then
      raise exception 'Invalid import fields' using errcode='22023';
    end if;
    if (v_row->>'amount')::numeric<0 or (v_row->>'amount')::numeric>999999999999.99
      or trunc((v_row->>'amount')::numeric,2)<>(v_row->>'amount')::numeric then
      raise exception 'Invalid import amount' using errcode='22023';
    end if;
    -- Cast every date before legacy filtering, not only newly inserted rows.
    if to_char((v_row->>'occurred_on')::date,'YYYY-MM-DD') is distinct from (v_row->>'occurred_on') then
      raise exception 'Invalid import date' using errcode='22023';
    end if;
  end loop;

  -- Check distinct parent sets once, rather than repeating three ownership
  -- queries for every imported row from the same account/project.
  select array_agg(distinct x.account_id) filter(where x.account_id is not null),
    array_agg(distinct x.project_id) filter(where x.project_id is not null),
    array_agg(distinct x.subscription_id) filter(where x.subscription_id is not null)
    into account_ids,project_ids,subscription_ids
    from jsonb_to_recordset(p_rows) x(account_id uuid,project_id uuid,subscription_id uuid);
  if (select count(*) from public.accounts where user_id=actor and id=any(account_ids))<>coalesce(cardinality(account_ids),0)
    or (select count(*) from public.projects where user_id=actor and id=any(project_ids))<>coalesce(cardinality(project_ids),0)
    or (select count(*) from public.subscriptions where user_id=actor and id=any(subscription_ids))<>coalesce(cardinality(subscription_ids),0) then
    raise exception 'Import parent not owned' using errcode='42501';
  end if;
  return actor;
end $$;

create or replace function public.import_transaction_batch(p_rows jsonb,p_user_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; result jsonb;
begin
  actor := public.validate_transaction_import_rows(p_rows,p_user_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transaction-import:'||actor::text,0));
  perform a.id from public.accounts a where a.user_id=actor and a.id in
    (select (r->>'account_id')::uuid from jsonb_array_elements(p_rows) r) order by a.id for key share;
  perform p.id from public.projects p where p.user_id=actor and p.id in
    (select (r->>'project_id')::uuid from jsonb_array_elements(p_rows) r) order by p.id for key share;
  perform s.id from public.subscriptions s where s.user_id=actor and s.id in
    (select (r->>'subscription_id')::uuid from jsonb_array_elements(p_rows) r) order by s.id for key share;
  perform t.id from public.transactions t where t.user_id=actor and t.external_id in
    (select r->>'external_id' from jsonb_array_elements(p_rows) r union all
     select 'bank:v2:'||(r->>'account_id')::uuid::text||':'||encode(sha256(convert_to(r->>'external_id','UTF8')),'hex') from jsonb_array_elements(p_rows) r where r->>'external_id' not like 'bank:v2:%') order by t.id for share;
  if exists(select 1 from jsonb_array_elements(p_rows) r group by r->>'external_id' having count(distinct r)>1) then
    raise exception 'Import identity not confirmed' using errcode='40001';
  end if;
  with inserted as (
    insert into public.transactions(user_id,account_id,kind,amount,currency,category,note,occurred_on,external_id,variable_symbol,project_id,subscription_id)
      select actor,x.account_id,x.kind,x.amount,x.currency,x.category,x.note,x.occurred_on,x.external_id,x.variable_symbol,x.project_id,x.subscription_id
      from jsonb_to_recordset(p_rows) as x(account_id uuid,kind text,amount numeric,currency text,category text,note text,
        occurred_on date,external_id text,variable_symbol text,project_id uuid,subscription_id uuid)
      where not exists(select 1 from public.transactions t where x.external_id not like 'bank:v2:%' and t.user_id=actor and t.account_id=x.account_id
        and t.external_id='bank:v2:'||x.account_id::text||':'||encode(sha256(convert_to(x.external_id,'UTF8')),'hex'))
      order by x.external_id
      on conflict(user_id,external_id) where external_id is not null do nothing returning id
  ) select coalesce(jsonb_agg(id),'[]'::jsonb) into result from inserted;
  -- A conflict is a successful repeat only for the same source account. Also
  -- detect a BEFORE INSERT trigger that silently suppresses an intended row.
  if exists(select 1 from jsonb_array_elements(p_rows) r where not exists(
    select 1 from public.transactions t where t.user_id=actor and t.account_id is not distinct from (r->>'account_id')::uuid
      and (t.external_id=r->>'external_id' or (r->>'external_id' not like 'bank:v2:%' and t.external_id='bank:v2:'||(r->>'account_id')::uuid::text||':'||encode(sha256(convert_to(r->>'external_id','UTF8')),'hex')))
  )) then
    raise exception 'Import identity not confirmed' using errcode='40001';
  end if;
  if exists(select 1 from public.transactions t join jsonb_to_recordset(p_rows) as x(
    account_id uuid,kind text,amount numeric,currency text,category text,note text,occurred_on date,external_id text,
    variable_symbol text,project_id uuid,subscription_id uuid) on t.external_id=x.external_id
    where t.user_id=actor and t.id in(select value::uuid from jsonb_array_elements_text(result))
      and row(t.account_id,t.kind,t.amount,t.currency,t.category,t.note,t.occurred_on,t.variable_symbol,t.project_id,t.subscription_id)
        is distinct from row(x.account_id,x.kind,x.amount,x.currency,x.category,x.note,x.occurred_on,x.variable_symbol,x.project_id,x.subscription_id)) then
    raise exception 'Import fields not confirmed' using errcode='40001';
  end if;
  return result;
end $$;

-- Bank pulls are service-only and use this wrapper; browser CSV imports keep
-- their existing versioned CSV identities through import_transaction_batch.
create function public.import_bank_transaction_batch(p_rows jsonb,p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; normalized jsonb;
begin
  actor := public.validate_transaction_import_rows(p_rows,p_user_id);
  if exists(select 1 from jsonb_array_elements(p_rows) r where r->>'account_id' is null) then
    raise exception 'Bank account required' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where r->>'external_id' like 'bank:v2:%') then
    raise exception 'Reserved bank source identity' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transaction-import:'||actor::text,0));
  perform a.id from public.accounts a where a.user_id=actor and a.id in
    (select (r->>'account_id')::uuid from jsonb_array_elements(p_rows) r) order by a.id for key share;
  perform p.id from public.projects p where p.user_id=actor and p.id in
    (select (r->>'project_id')::uuid from jsonb_array_elements(p_rows) r) order by p.id for key share;
  perform s.id from public.subscriptions s where s.user_id=actor and s.id in
    (select (r->>'subscription_id')::uuid from jsonb_array_elements(p_rows) r) order by s.id for key share;
  perform t.id from public.transactions t where t.user_id=actor and t.external_id in
    (select r->>'external_id' from jsonb_array_elements(p_rows) r) order by t.id for share;
  select coalesce(jsonb_agg(r || jsonb_build_object('external_id',
    'bank:v2:'||(r->>'account_id')::uuid::text||':'||encode(sha256(convert_to(r->>'external_id','UTF8')),'hex'))),'[]'::jsonb)
    into normalized from jsonb_array_elements(p_rows) r
    where not exists(select 1 from public.transactions t where t.user_id=actor and t.external_id=r->>'external_id'
      and t.account_id=(r->>'account_id')::uuid and t.external_id not like 'bank:v2:%');
  return public.import_transaction_batch(normalized,actor);
end $$;
revoke all on function public.validate_transaction_import_rows(jsonb,uuid),public.import_bank_transaction_batch(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.validate_transaction_import_rows(jsonb,uuid) to authenticated,service_role;
grant execute on function public.import_bank_transaction_batch(jsonb,uuid) to service_role;
comment on function public.import_bank_transaction_batch(jsonb,uuid) is
  'Service-only owner-bound bank imports: account UUID + SHA-256 source identity; confirms same-account legacy rows without rewriting them. 250 rows/1 MiB, atomic, replay-safe.';
