-- A document and its lines must commit together. Invoker rights retain both
-- own-only RLS and related organization/project ownership checks.
create function public.save_invoice_document(
  p_id uuid,
  p_creating boolean,
  p_header jsonb,
  p_items jsonb,
  p_expected_updated_at timestamptz default null,
  p_expected_item_ids uuid[] default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  saved public.invoices;
  proposed public.invoices;
  normalized jsonb;
  previous_items jsonb;
  current_ids uuid[];
  editable text[] := array['number','variable_symbol','constant_symbol','issue_date',
    'due_date','taxable_supply_date','payment_method','currency','round_total','note',
    'organization_id','project_id','buyer_name','buyer_address','buyer_city',
    'buyer_zip','buyer_country','buyer_ico','buyer_dic'];
  supplier text[] := array['status','supplier_name','supplier_address','supplier_city',
    'supplier_zip','supplier_country','supplier_ico','supplier_dic',
    'supplier_is_vat_payer','bank_account','iban','footer_note'];
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_creating is null
    or jsonb_typeof(p_header) is distinct from 'object'
    or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Invalid invoice document' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_header) k
    where not(k = any(editable || case when p_creating then supplier else array[]::text[] end)))
    or not(p_header ?& array['number','buyer_name','issue_date','due_date','currency','payment_method','round_total'])
    or nullif(btrim(p_header->>'number'),'') is null
    or nullif(btrim(p_header->>'buyer_name'),'') is null
    or jsonb_array_length(p_items) = 0 then
    raise exception 'Invalid invoice fields' using errcode='22023';
  end if;
  -- Reject precision loss rather than silently saving a different amount from
  -- the preview. Zero quantities and negative prices (discounts) are valid.
  if exists(select 1 from jsonb_array_elements(p_items) x where
    jsonb_typeof(x) is distinct from 'object'
    or nullif(btrim(x->>'description'),'') is null
    or jsonb_typeof(x->'quantity') is distinct from 'number'
    or jsonb_typeof(x->'unit_price') is distinct from 'number'
    or jsonb_typeof(x->'vat_rate') is distinct from 'number') then
    raise exception 'Invalid invoice lines' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where
    (x->>'quantity')::numeric < 0 or (x->>'quantity')::numeric > 99999999999.999
    or (x->>'quantity')::numeric <> round((x->>'quantity')::numeric,3)
    or abs((x->>'unit_price')::numeric) > 999999999999.99
    or (x->>'unit_price')::numeric <> round((x->>'unit_price')::numeric,2)
    or (x->>'vat_rate')::numeric < 0 or (x->>'vat_rate')::numeric > 999.99
    or (x->>'vat_rate')::numeric <> round((x->>'vat_rate')::numeric,2)) then
    raise exception 'Invalid invoice amounts' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('description',btrim(x->>'description'),
    'quantity',(x->>'quantity')::numeric,'unit',nullif(btrim(x->>'unit'),''),
    'unit_price',(x->>'unit_price')::numeric,'vat_rate',(x->>'vat_rate')::numeric,
    'position',n-1) order by n) into normalized
    from jsonb_array_elements(p_items) with ordinality as entries(x,n);

  -- Serializes retries sharing the client-generated id, including the first
  -- insert when there is not yet a row to lock. Never accepts a caller owner id.
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_id::text,0));
  select * into saved from public.invoices where id=p_id and user_id=actor for update;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('description',description,
      'quantity',quantity,'unit',unit,'unit_price',unit_price,'vat_rate',vat_rate,
      'position',position) order by position,id),'[]'::jsonb),
      coalesce(array_agg(id order by id),array[]::uuid[])
      into previous_items,current_ids from public.invoice_items where invoice_id=p_id and user_id=actor;
    -- A lost HTTP response can be retried without creating another document or
    -- replacing its lines again. A changed retry is a conflict, not an overwrite.
    if to_jsonb(saved) @> p_header and previous_items=normalized then
      return jsonb_build_object('invoice',to_jsonb(saved),'items',
        (select coalesce(jsonb_agg(to_jsonb(i) order by i.position,i.id),'[]'::jsonb)
         from public.invoice_items i where i.invoice_id=p_id and i.user_id=actor));
    end if;
    if p_creating or p_expected_updated_at is distinct from saved.updated_at
      or p_expected_item_ids is null
      or current_ids is distinct from (select coalesce(array_agg(x order by x),array[]::uuid[]) from unnest(p_expected_item_ids) x) then
      raise exception 'Invoice changed; reload before editing' using errcode='40001';
    end if;
  elsif not p_creating then
    raise exception 'Invoice not found' using errcode='P0002';
  else
    if p_header->>'status' is null or p_header->>'status' not in ('draft','issued') then
      raise exception 'Invalid initial invoice status' using errcode='22023';
    end if;
    saved.currency := 'CZK'; saved.round_total := true;
    saved.buyer_country := 'Česká republika'; saved.supplier_country := 'Česká republika';
    saved.supplier_name := ''; saved.supplier_is_vat_payer := false;
  end if;
  proposed := jsonb_populate_record(saved,p_header);
  if proposed.issue_date is null or proposed.due_date is null
    or proposed.currency !~ '^[A-Z]{3}$' then
    raise exception 'Invalid invoice dates or currency' using errcode='22023';
  end if;
  if p_creating then
    insert into public.invoices(id,user_id,number,variable_symbol,constant_symbol,
      issue_date,due_date,taxable_supply_date,payment_method,currency,status,round_total,
      buyer_name,buyer_address,buyer_city,buyer_zip,buyer_country,buyer_ico,buyer_dic,
      supplier_name,supplier_address,supplier_city,supplier_zip,supplier_country,
      supplier_ico,supplier_dic,supplier_is_vat_payer,bank_account,iban,note,footer_note,
      organization_id,project_id)
    values(p_id,actor,proposed.number,proposed.variable_symbol,proposed.constant_symbol,
      proposed.issue_date,proposed.due_date,proposed.taxable_supply_date,proposed.payment_method,
      proposed.currency,proposed.status,proposed.round_total,proposed.buyer_name,
      proposed.buyer_address,proposed.buyer_city,proposed.buyer_zip,proposed.buyer_country,
      proposed.buyer_ico,proposed.buyer_dic,proposed.supplier_name,proposed.supplier_address,
      proposed.supplier_city,proposed.supplier_zip,proposed.supplier_country,proposed.supplier_ico,
      proposed.supplier_dic,proposed.supplier_is_vat_payer,proposed.bank_account,proposed.iban,
      proposed.note,proposed.footer_note,proposed.organization_id,proposed.project_id)
    returning * into saved;
  else
    update public.invoices set number=proposed.number,variable_symbol=proposed.variable_symbol,
      constant_symbol=proposed.constant_symbol,issue_date=proposed.issue_date,due_date=proposed.due_date,
      taxable_supply_date=proposed.taxable_supply_date,payment_method=proposed.payment_method,
      currency=proposed.currency,round_total=proposed.round_total,note=proposed.note,
      organization_id=proposed.organization_id,project_id=proposed.project_id,
      buyer_name=proposed.buyer_name,buyer_address=proposed.buyer_address,buyer_city=proposed.buyer_city,
      buyer_zip=proposed.buyer_zip,buyer_country=proposed.buyer_country,buyer_ico=proposed.buyer_ico,
      buyer_dic=proposed.buyer_dic,updated_at=clock_timestamp()
      where id=p_id and user_id=actor returning * into saved;
    delete from public.invoice_items where invoice_id=p_id and user_id=actor;
  end if;
  insert into public.invoice_items(invoice_id,user_id,description,quantity,unit,unit_price,vat_rate,position)
    select p_id,actor,x->>'description',(x->>'quantity')::numeric,x->>'unit',
      (x->>'unit_price')::numeric,(x->>'vat_rate')::numeric,(x->>'position')::int
      from jsonb_array_elements(normalized) x;
  return jsonb_build_object('invoice',to_jsonb(saved),'items',
    (select jsonb_agg(to_jsonb(i) order by i.position,i.id) from public.invoice_items i
     where i.invoice_id=p_id and i.user_id=actor));
end;
$$;
revoke all on function public.save_invoice_document(uuid,boolean,jsonb,jsonb,timestamptz,uuid[]) from public,anon,service_role;
grant execute on function public.save_invoice_document(uuid,boolean,jsonb,jsonb,timestamptz,uuid[]) to authenticated;
comment on function public.save_invoice_document(uuid,boolean,jsonb,jsonb,timestamptz,uuid[]) is
  'Own-only atomic invoice header/line save with retry identity and stale/incomplete-edit protection; preserves issued supplier snapshot and status.';
