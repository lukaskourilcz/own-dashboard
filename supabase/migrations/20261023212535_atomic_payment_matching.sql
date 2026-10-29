-- Complete matching input and atomic payment/invoice writes. Tax calculations
-- stay in the shared TypeScript invoice calculator; SQL checks source identity.
create or replace function public.payment_matching_snapshot(
  p_user_id uuid, p_transaction_id uuid default null, p_invoice_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if p_user_id is null or (current_user <> 'service_role' and p_user_id is distinct from (select auth.uid())) then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  with inv as (
    select i.id,i.number,i.variable_symbol,i.currency,i.status,i.round_total,i.issue_date,i.updated_at,i.payment_method,
      case when i.status='issued' or p_invoice_id is not null then (select md5(coalesce(jsonb_agg(jsonb_build_array(l.id,l.quantity,l.unit_price,l.vat_rate) order by l.id),'[]'::jsonb)::text)
        from public.invoice_items l where l.user_id=p_user_id and l.invoice_id=i.id) else null end as items_version
    from public.invoices i where i.user_id=p_user_id and
      ((p_invoice_id is not null and i.id=p_invoice_id) or
       (p_invoice_id is null and i.status in ('issued','paid') and i.payment_method='bank'))
    order by i.id limit 10001
  ), lines as (
    select l.id,l.invoice_id,l.quantity,l.unit_price,l.vat_rate from public.invoice_items l
    where l.user_id=p_user_id and exists(select 1 from inv i where i.id=l.invoice_id and (i.status='issued' or p_invoice_id is not null))
    order by l.id limit 50001
  ), tx as (
    select t.id,t.kind,t.amount,t.currency,t.note,t.occurred_on,t.variable_symbol,t.invoice_id,
      md5(jsonb_build_array(t.kind,t.amount,t.currency,t.note,t.occurred_on,t.variable_symbol,t.invoice_id)::text) as match_version
    from public.transactions t where t.user_id=p_user_id and
      ((p_transaction_id is not null and t.id=p_transaction_id) or
       (p_transaction_id is null and t.kind='income' and t.invoice_id is null and
        t.occurred_on >= (select min(i.issue_date) from inv i where i.status='issued')))
    order by t.occurred_on,t.id limit 20001
  ) select jsonb_build_object(
    'invoices',coalesce((select jsonb_agg(to_jsonb(i)) from inv i),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(l)) from lines l),'[]'::jsonb),
    'transactions',coalesce((select jsonb_agg(to_jsonb(t)) from tx t),'[]'::jsonb)
  ) into v_result;
  if jsonb_array_length(v_result->'invoices')>10000 or jsonb_array_length(v_result->'items')>50000
    or jsonb_array_length(v_result->'transactions')>20000 or octet_length(v_result::text)>10485760 then
    raise exception 'Payment matching exceeds the complete read bound' using errcode='54000';
  end if;
  return v_result;
end $$;

create or replace function public.settle_invoice_payments(p_user_id uuid,p_matches jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_match jsonb; v_invoice public.invoices; v_tx public.transactions;
  v_items_version text; v_tx_version text; v_result jsonb := '[]'::jsonb;
begin
  if p_user_id is null or (current_user <> 'service_role' and p_user_id is distinct from (select auth.uid())) then
    raise exception 'Owner required' using errcode='42501';
  end if;
  if p_matches is null or jsonb_typeof(p_matches)<>'array' or jsonb_array_length(p_matches)>100 or octet_length(p_matches::text)>100000 then
    raise exception 'Invalid payment batch' using errcode='22023';
  end if;
  -- Consistent lock order across manual and scheduled passes. The header lock
  -- also serializes the shared invoice document writer and new line references.
  perform i.id from public.invoices i where i.user_id=p_user_id and i.id in
    (select (m->>'invoice_id')::uuid from jsonb_array_elements(p_matches) m) order by i.id for update;
  perform l.id from public.invoice_items l where l.user_id=p_user_id and l.invoice_id in
    (select (m->>'invoice_id')::uuid from jsonb_array_elements(p_matches) m) order by l.id for update;
  perform t.id from public.transactions t where t.user_id=p_user_id and t.id in
    (select (m->>'transaction_id')::uuid from jsonb_array_elements(p_matches) m) order by t.id for update;
  for v_match in select value from jsonb_array_elements(p_matches) loop
    if v_match->>'source' not in ('auto','manual') or v_match->>'source' is null then
      raise exception 'Invalid payment source' using errcode='22023';
    end if;
    select * into v_invoice from public.invoices where id=(v_match->>'invoice_id')::uuid and user_id=p_user_id;
    if not found then continue; end if;
    select * into v_tx from public.transactions where id=(v_match->>'transaction_id')::uuid and user_id=p_user_id;
    if not found or v_tx.kind<>'income' then continue; end if;
    if v_tx.invoice_id=v_invoice.id and v_invoice.status='paid' then
      v_result := v_result || jsonb_build_array(jsonb_build_object('transaction_id',v_tx.id,'invoice_id',v_invoice.id,'paid_on',v_invoice.paid_on,'changed',false));
      continue;
    end if;
    if v_tx.invoice_id is not null or v_invoice.status<>'issued' or v_invoice.payment_method<>'bank' then continue; end if;
    if v_invoice.updated_at is distinct from (v_match->>'invoice_updated_at')::timestamptz then continue; end if;
    select md5(coalesce(jsonb_agg(jsonb_build_array(l.id,l.quantity,l.unit_price,l.vat_rate) order by l.id),'[]'::jsonb)::text)
      into v_items_version from public.invoice_items l where l.user_id=p_user_id and l.invoice_id=v_invoice.id;
    v_tx_version := md5(jsonb_build_array(v_tx.kind,v_tx.amount,v_tx.currency,v_tx.note,v_tx.occurred_on,v_tx.variable_symbol,v_tx.invoice_id)::text);
    if v_items_version is distinct from (v_match->>'items_version') or v_tx_version is distinct from (v_match->>'transaction_version') then continue; end if;
    update public.transactions set invoice_id=v_invoice.id,matched_at=now(),match_source=v_match->>'source'
      where id=v_tx.id and user_id=p_user_id;
    if not found then raise exception 'Payment link not written' using errcode='40001'; end if;
    update public.invoices set status='paid',paid_on=v_tx.occurred_on,updated_at=now()
      where id=v_invoice.id and user_id=p_user_id;
    if not found then raise exception 'Invoice settlement not written' using errcode='40001'; end if;
    v_result := v_result || jsonb_build_array(jsonb_build_object('transaction_id',v_tx.id,'invoice_id',v_invoice.id,'paid_on',v_tx.occurred_on,'changed',true));
  end loop;
  return v_result;
end $$;

-- Distinct owners must not disappear behind the REST row limit on invoices.
create or replace function public.payment_matching_owners() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
  select coalesce(jsonb_agg(user_id),'[]'::jsonb) into v_result from
    (select distinct user_id from public.invoices where status='issued' and payment_method='bank' order by user_id limit 51) owners;
  if jsonb_array_length(v_result)>50 then raise exception 'Payment matching owner bound exceeded' using errcode='54000'; end if;
  return v_result;
end $$;
revoke all on function public.payment_matching_snapshot(uuid,uuid,uuid),public.settle_invoice_payments(uuid,jsonb),public.payment_matching_owners() from public,anon,authenticated,service_role;
grant execute on function public.payment_matching_snapshot(uuid,uuid,uuid),public.settle_invoice_payments(uuid,jsonb) to authenticated,service_role;
grant execute on function public.payment_matching_owners() to service_role;
