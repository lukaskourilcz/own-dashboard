-- Captured credential-renewal foundation; caller adoption precedes deployment.
create function public.renew_owned_marketing_credential(
 p_owner uuid,p_expected_id uuid,p_expected_at timestamptz,p_expected_token jsonb,
 p_brand text,p_platform text,p_token text,p_expires_at timestamptz,p_scopes text[],p_login_mode text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare before_row public.marketing_accounts;after_row public.marketing_accounts;
 before_tokens jsonb;after_tokens jsonb;before_token jsonb;after_token jsonb;
 expected_fingerprint jsonb;fingerprint jsonb;expected_expiry timestamptz;expected_refresh timestamptz;
 result jsonb;intent jsonb;expected_token jsonb;public_token jsonb;
begin
 if current_user<>'service_role' then raise exception 'Credential renewal unavailable' using errcode='42501';end if;
 if p_owner is null or p_expected_id is null or p_expected_at is null or not isfinite(p_expected_at)
  or extract(year from p_expected_at) not between 1 and 9999
  or p_brand is null or p_brand not in('dneskai','devshark') or p_platform is distinct from 'instagram'
  or p_token is null or char_length(p_token) not between 20 and 4096 or p_token ~ '\s'
  or p_expires_at is null or not isfinite(p_expires_at) or extract(year from p_expires_at) not between 1 and 9999 or p_expires_at<=clock_timestamp()
  or p_login_mode is null or p_login_mode not in('instagram','facebook')
  or p_scopes is null or cardinality(p_scopes)>20
  or (cardinality(p_scopes)>0 and (array_ndims(p_scopes) is distinct from 1 or array_lower(p_scopes,1) is distinct from 1))
  or exists(select 1 from unnest(p_scopes) s where s is null or s !~ '^[a-z_]{1,64}$')
  or (select count(distinct s) from unnest(p_scopes) s)<>cardinality(p_scopes) then
  raise exception 'Credential renewal invalid' using errcode='22023';end if;
 p_expected_token:=nullif(p_expected_token,'null'::jsonb);
 if p_expected_token is not null then
  if jsonb_typeof(p_expected_token) is distinct from 'object' or not p_expected_token?&array['tokenHash','expiresAt','refreshedAt','scopes','loginMode']
   or (p_expected_token-array['tokenHash','expiresAt','refreshedAt','scopes','loginMode'])<>'{}'::jsonb
   or jsonb_typeof(p_expected_token->'tokenHash') is distinct from 'string' or p_expected_token->>'tokenHash' !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_expected_token->'expiresAt') is distinct from 'string' or jsonb_typeof(p_expected_token->'refreshedAt') is distinct from 'string'
   or jsonb_typeof(p_expected_token->'scopes') is distinct from 'array'
   or jsonb_typeof(p_expected_token->'loginMode') is distinct from 'string' or p_expected_token->>'loginMode' not in('instagram','facebook') then
   raise exception 'Credential renewal invalid' using errcode='22023';end if;
  if jsonb_array_length(p_expected_token->'scopes')>20
   or exists(select 1 from jsonb_array_elements(p_expected_token->'scopes') s where jsonb_typeof(s)<>'string' or s#>>'{}' !~ '^[a-z_]{1,64}$')
   or (select count(distinct s) from jsonb_array_elements_text(p_expected_token->'scopes') s)<>jsonb_array_length(p_expected_token->'scopes') then
   raise exception 'Credential renewal invalid' using errcode='22023';end if;
  begin
   expected_expiry:=(p_expected_token->>'expiresAt')::timestamptz;expected_refresh:=(p_expected_token->>'refreshedAt')::timestamptz;
  exception when others then raise exception 'Credential renewal invalid' using errcode='22023';end;
  if expected_expiry is null or expected_refresh is null or not isfinite(expected_expiry) or not isfinite(expected_refresh)
   or extract(year from expected_expiry) not between 1 and 9999 or extract(year from expected_refresh) not between 1 and 9999 then
   raise exception 'Credential renewal invalid' using errcode='22023';end if;
  expected_fingerprint:=jsonb_build_object('tokenHash',p_expected_token->'tokenHash','expiresAt',expected_expiry,
   'refreshedAt',expected_refresh,'scopes',p_expected_token->'scopes','loginMode',p_expected_token->'loginMode');
 end if;
 intent:=jsonb_build_object('ownerId',p_owner,'expectedId',p_expected_id,'expectedVersion',p_expected_at);
 -- Shared order: tuple advisory lock, account UPDATE lock, then credential access.
 perform pg_advisory_xact_lock(hashtextextended('marketing-account:'||p_owner::text||':'||p_brand||':'||p_platform,0));
 select * into before_row from public.marketing_accounts where user_id=p_owner and brand=p_brand and platform=p_platform for update;
 if before_row.id is distinct from p_expected_id or before_row.updated_at is distinct from p_expected_at then
  return intent||jsonb_build_object('kind','changed','id',before_row.id,'updatedAt',before_row.updated_at);end if;
 begin
  select jsonb_agg(to_jsonb(t)) into before_tokens from public.marketing_read_account_token(p_owner,before_row.id) t;
  if before_tokens is not null then
   if jsonb_array_length(before_tokens)<>1 or octet_length(before_tokens::text)>8192 then raise exception 'Unconfirmed';end if;
   before_token:=before_tokens->0;
   fingerprint:=jsonb_build_object('tokenHash',encode(sha256(convert_to(before_token->>'access_token','UTF8')),'hex'),
    'expiresAt',before_token->'expires_at','refreshedAt',before_token->'refreshed_at','scopes',before_token->'scopes','loginMode',before_token->'login_mode');
  end if;
  if fingerprint is distinct from expected_fingerprint then
   return intent||jsonb_build_object('kind','changed','id',before_row.id,'updatedAt',before_row.updated_at);end if;
  if expected_expiry is not null and p_expires_at<expected_expiry then raise exception 'Unconfirmed';end if;
  -- Delegate private access to the existing service-only writer; no token-table grants.
  result:=public.marketing_store_account_token(p_owner,before_row.id,expected_refresh,p_token,p_expires_at,p_scopes,p_login_mode);
  select * into after_row from public.marketing_accounts where id=before_row.id and user_id=p_owner;
  if not found or to_jsonb(after_row) is distinct from to_jsonb(before_row) then raise exception 'Unconfirmed';end if;
  select jsonb_agg(to_jsonb(t)) into after_tokens from public.marketing_read_account_token(p_owner,before_row.id) t;
  if after_tokens is null or jsonb_array_length(after_tokens)<>1 or octet_length(after_tokens::text)>8192 then raise exception 'Unconfirmed';end if;
  after_token:=after_tokens->0;
  expected_token:=jsonb_build_object('access_token',p_token,'expires_at',p_expires_at,'refreshed_at',now(),'scopes',to_jsonb(p_scopes),'login_mode',p_login_mode);
  if after_token is distinct from expected_token or not isfinite((after_token->>'refreshed_at')::timestamptz)
   or (expected_refresh is not null and (after_token->>'refreshed_at')::timestamptz<=expected_refresh) then raise exception 'Unconfirmed';end if;
  public_token:=jsonb_build_object('expiresAt',after_token->'expires_at','refreshedAt',after_token->'refreshed_at','scopes',after_token->'scopes','loginMode',after_token->'login_mode');
  if result is distinct from jsonb_build_object('accountId',before_row.id,'token',public_token) then raise exception 'Unconfirmed';end if;
  -- Emit only non-secret persisted metadata and the original account intent.
  return intent||jsonb_build_object('kind','refreshed','id',before_row.id,'updatedAt',before_row.updated_at,'result',result);
 exception when others then raise exception 'Credential renewal unconfirmed' using errcode='40001';end;
end $$;
revoke all on function public.renew_owned_marketing_credential(uuid,uuid,timestamptz,jsonb,text,text,text,timestamptz,text[],text) from public,anon,authenticated,service_role;
grant execute on function public.renew_owned_marketing_credential(uuid,uuid,timestamptz,jsonb,text,text,text,timestamptz,text[],text) to service_role;
comment on function public.renew_owned_marketing_credential(uuid,uuid,timestamptz,jsonb,text,text,text,timestamptz,text[],text) is
 'Captured owner/account/version and private credential fingerprint; account-first locking, exact persisted token and unchanged account proof with rollback. No credential/fingerprint in receipts. Service-only invoker; no row, table privilege or RLS changes.';
