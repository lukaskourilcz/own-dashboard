-- Existing per-owner Fio storage only. No credentials or connections are added
-- by applying this migration. RPCs are invoker/service-only and return receipts.
create or replace function public.store_bank_token(p_user_id uuid, p_provider text, p_secret text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  connection_ids uuid[];
  connection_id uuid;
begin
  if p_user_id is null or p_provider is distinct from 'fio' or p_secret is null
     or length(btrim(p_secret)) not between 16 and 512 then
    raise exception 'Invalid bank credential request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bank-token:' || p_user_id::text, 0));
  perform id from public.bank_connections where user_id = p_user_id and provider = p_provider for update;
  select array_agg(id) into connection_ids from public.bank_connections where user_id = p_user_id and provider = p_provider;
  if coalesce(cardinality(connection_ids), 0) > 1 then raise exception 'Ambiguous bank connection'; end if;
  connection_id := connection_ids[1];
  if connection_id is null then
    insert into public.bank_connections(user_id,provider,institution_name,reference,status)
    values(p_user_id,p_provider,'Fio banka',gen_random_uuid()::text,'created') returning id into connection_id;
  else
    update public.bank_connections set status='created', last_error=null where id=connection_id and user_id=p_user_id;
  end if;
  insert into public.bank_provider_credentials(user_id,provider,secret) values(p_user_id,p_provider,btrim(p_secret))
  on conflict(user_id,provider) do update set secret=excluded.secret;
  return connection_id;
end $$;
revoke all on function public.store_bank_token(uuid,text,text) from public, anon, authenticated;
grant execute on function public.store_bank_token(uuid,text,text) to service_role;

create or replace function public.forget_bank_token(p_user_id uuid, p_provider text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_user_id is null or p_provider is distinct from 'fio' then raise exception 'Invalid bank credential request'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bank-token:' || p_user_id::text, 0));
  delete from public.bank_connections where user_id=p_user_id and provider=p_provider;
  delete from public.bank_provider_credentials where user_id=p_user_id and provider=p_provider;
  return true;
end $$;
revoke all on function public.forget_bank_token(uuid,text) from public, anon, authenticated;
grant execute on function public.forget_bank_token(uuid,text) to service_role;
