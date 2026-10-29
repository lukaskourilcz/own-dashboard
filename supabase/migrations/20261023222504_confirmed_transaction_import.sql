-- Use the existing partial unique index explicitly. PostgREST's unqualified
-- ON CONFLICT(user_id,external_id) cannot infer its non-null predicate.
create function public.import_transaction_batch(p_rows jsonb,p_user_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid := coalesce(p_user_id,(select auth.uid())); result jsonb; v_row jsonb;
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
    -- Service sync bypasses RLS but must retain the same parent ownership.
    if (v_row->>'account_id' is not null and not exists(select 1 from public.accounts where id=(v_row->>'account_id')::uuid and user_id=actor))
      or (v_row->>'project_id' is not null and not exists(select 1 from public.projects where id=(v_row->>'project_id')::uuid and user_id=actor))
      or (v_row->>'subscription_id' is not null and not exists(select 1 from public.subscriptions where id=(v_row->>'subscription_id')::uuid and user_id=actor)) then
      raise exception 'Import parent not owned' using errcode='42501';
    end if;
  end loop;
  with inserted as (
    insert into public.transactions(user_id,account_id,kind,amount,currency,category,note,occurred_on,external_id,variable_symbol,project_id,subscription_id)
      select actor,x.account_id,x.kind,x.amount,x.currency,x.category,x.note,x.occurred_on,x.external_id,x.variable_symbol,x.project_id,x.subscription_id
      from jsonb_to_recordset(p_rows) as x(account_id uuid,kind text,amount numeric,currency text,category text,note text,
        occurred_on date,external_id text,variable_symbol text,project_id uuid,subscription_id uuid)
      on conflict(user_id,external_id) where external_id is not null do nothing returning id
  ) select coalesce(jsonb_agg(id),'[]'::jsonb) into result from inserted;
  return result;
end $$;
revoke all on function public.import_transaction_batch(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.import_transaction_batch(jsonb,uuid) to authenticated,service_role;
