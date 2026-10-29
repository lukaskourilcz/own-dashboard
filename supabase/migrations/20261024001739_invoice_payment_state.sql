-- Manual payment state and linked-ledger metadata must move together. Applying
-- this migration changes no invoice or transaction; all operations remain RLS.
create function public.set_invoice_payment_state(p_invoice_id uuid,p_expected_updated_at timestamptz,p_paid boolean,p_paid_on date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid := (select auth.uid()); current_invoice public.invoices; linked_ids uuid[];
begin
  if actor is null then raise exception 'Owner required' using errcode='42501'; end if;
  if p_invoice_id is null or p_expected_updated_at is null or p_paid is null or (p_paid and p_paid_on is null) or (not p_paid and p_paid_on is not null) then
    raise exception 'Invalid invoice payment state' using errcode='22023';
  end if;
  select * into current_invoice from public.invoices where id=p_invoice_id and user_id=actor for update;
  if not found then raise exception 'Invoice not found' using errcode='P0002'; end if;
  -- Same header-before-ledger lock order as the settlement writer. The header
  -- lock also blocks new foreign-key references until this operation finishes.
  perform id from public.transactions where user_id=actor and invoice_id=p_invoice_id order by id limit 1001 for update;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into linked_ids from
    (select id from public.transactions where user_id=actor and invoice_id=p_invoice_id order by id limit 1001) linked;
  if cardinality(linked_ids)>1000 then raise exception 'Invoice payment link bound exceeded' using errcode='54000'; end if;
  if (p_paid and current_invoice.status='paid' and current_invoice.paid_on=p_paid_on)
    or (not p_paid and current_invoice.status='issued' and current_invoice.paid_on is null and cardinality(linked_ids)=0) then
    return jsonb_build_object('invoice',to_jsonb(current_invoice),'unlinked_transaction_ids','[]'::jsonb);
  end if;
  if current_invoice.updated_at is distinct from p_expected_updated_at then raise exception 'Invoice changed' using errcode='40001'; end if;
  if not p_paid and current_invoice.status='draft' then raise exception 'Invalid invoice payment state' using errcode='22023'; end if;
  if not p_paid then
    update public.transactions set invoice_id=null,matched_at=null,match_source=null where user_id=actor and id=any(linked_ids);
  end if;
  update public.invoices set status=case when p_paid then 'paid' else 'issued' end,paid_on=p_paid_on,updated_at=now()
    where id=p_invoice_id and user_id=actor returning * into current_invoice;
  if not found then raise exception 'Invoice payment state unconfirmed' using errcode='40001'; end if;
  return jsonb_build_object('invoice',to_jsonb(current_invoice),'unlinked_transaction_ids',case when p_paid then '[]'::jsonb else to_jsonb(linked_ids) end);
end $$;
revoke all on function public.set_invoice_payment_state(uuid,timestamptz,boolean,date) from public,anon,authenticated,service_role;
grant execute on function public.set_invoice_payment_state(uuid,timestamptz,boolean,date) to authenticated;

-- Invoice deletion uses ON DELETE SET NULL. Clear the associated metadata in
-- that same transaction too; imported financial rows are retained.
create function public.tg_clear_invoice_payment_match() returns trigger
language plpgsql security invoker set search_path='' as $$
begin new.matched_at:=null; new.match_source:=null; return new; end $$;
revoke all on function public.tg_clear_invoice_payment_match() from public,anon,authenticated,service_role;
create trigger clear_invoice_payment_match before update of invoice_id on public.transactions
for each row when (old.invoice_id is not null and new.invoice_id is null) execute function public.tg_clear_invoice_payment_match();
