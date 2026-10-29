-- Captured verification foundation. API adoption follows before deployment.
create function public.verify_owned_marketing_account(
 p_owner uuid,p_expected_id uuid,p_expected_at timestamptz,p_expected_token jsonb,
 p_brand text,p_platform text,p_remote_account_id text,p_handle text,
 p_token text,p_expires_at timestamptz,p_scopes text[],p_login_mode text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare before_row public.marketing_accounts;after_row public.marketing_accounts;
 before_tokens jsonb;after_tokens jsonb;before_token jsonb;after_token jsonb;fingerprint jsonb;expected_fingerprint jsonb;
 result jsonb;intent jsonb;expected_token jsonb;public_token jsonb;expected_expiry timestamptz;expected_refresh timestamptz;
 identity_changed boolean;should_store boolean;expected_enabled boolean;expected_engagement boolean;
begin
 if current_user<>'service_role' then raise exception 'Account verification unavailable' using errcode='42501';end if;
 if p_owner is null or p_brand is distinct from 'dneskai' or p_platform is distinct from 'instagram'
  or (p_expected_id is null)<>(p_expected_at is null)
  or (p_expected_at is not null and (not isfinite(p_expected_at) or extract(year from p_expected_at) not between 1 and 9999))
  or p_remote_account_id is null or p_remote_account_id !~ '^[0-9]{1,100}$'
  or p_handle is null or p_handle !~ '^[A-Za-z0-9._]{1,30}$'
  or p_token is null or char_length(p_token) not between 20 and 4096 or p_token ~ '\s'
  or p_expires_at is null or not isfinite(p_expires_at) or extract(year from p_expires_at) not between 1 and 9999 or p_expires_at<=clock_timestamp()
  or p_login_mode is null or p_login_mode not in('instagram','facebook')
  or p_scopes is null or array_ndims(p_scopes) is distinct from 1 or array_lower(p_scopes,1) is distinct from 1 or cardinality(p_scopes)>20
  or exists(select 1 from unnest(p_scopes) s where s is null or s !~ '^[a-z_]{1,64}$')
  or (select count(distinct s) from unnest(p_scopes) s)<>cardinality(p_scopes) then
  raise exception 'Account verification invalid' using errcode='22023';end if;
 if (p_login_mode='instagram' and not p_scopes@>array['instagram_business_basic','instagram_business_content_publish'])
  or (p_login_mode='facebook' and not p_scopes@>array['instagram_basic','instagram_content_publish','pages_read_engagement','pages_show_list']) then
  raise exception 'Account verification invalid' using errcode='22023';end if;
 p_expected_token:=nullif(p_expected_token,'null'::jsonb);
 if p_expected_token is not null then
  if p_expected_id is null or jsonb_typeof(p_expected_token) is distinct from 'object' then
   raise exception 'Account verification invalid' using errcode='22023';end if;
  if not p_expected_token?&array['tokenHash','expiresAt','refreshedAt','scopes','loginMode']
   or (p_expected_token-array['tokenHash','expiresAt','refreshedAt','scopes','loginMode'])<>'{}'::jsonb
   or jsonb_typeof(p_expected_token->'tokenHash') is distinct from 'string' or p_expected_token->>'tokenHash' !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_expected_token->'expiresAt') is distinct from 'string' or jsonb_typeof(p_expected_token->'refreshedAt') is distinct from 'string'
   or jsonb_typeof(p_expected_token->'scopes') is distinct from 'array'
   or jsonb_typeof(p_expected_token->'loginMode') is distinct from 'string' or p_expected_token->>'loginMode' not in('instagram','facebook') then
   raise exception 'Account verification invalid' using errcode='22023';end if;
  if jsonb_array_length(p_expected_token->'scopes')>20
   or exists(select 1 from jsonb_array_elements(p_expected_token->'scopes') s where jsonb_typeof(s)<>'string' or s#>>'{}' !~ '^[a-z_]{1,64}$')
   or (select count(distinct s) from jsonb_array_elements_text(p_expected_token->'scopes') s)<>jsonb_array_length(p_expected_token->'scopes') then
   raise exception 'Account verification invalid' using errcode='22023';end if;
  begin
   expected_expiry:=(p_expected_token->>'expiresAt')::timestamptz;expected_refresh:=(p_expected_token->>'refreshedAt')::timestamptz;
  exception when others then raise exception 'Account verification invalid' using errcode='22023';end;
  if expected_expiry is null or expected_refresh is null or not isfinite(expected_expiry) or not isfinite(expected_refresh)
   or extract(year from expected_expiry) not between 1 and 9999 or extract(year from expected_refresh) not between 1 and 9999 then
   raise exception 'Account verification invalid' using errcode='22023';end if;
  expected_fingerprint:=jsonb_build_object('tokenHash',p_expected_token->'tokenHash','expiresAt',expected_expiry,
   'refreshedAt',expected_refresh,'scopes',p_expected_token->'scopes','loginMode',p_expected_token->'loginMode');
 end if;
 intent:=jsonb_build_object('ownerId',p_owner,'expectedId',p_expected_id,'expectedVersion',p_expected_at);
 -- Same order as the existing verification writer: tuple advisory lock, account, credential.
 perform pg_advisory_xact_lock(hashtextextended('marketing-account:'||p_owner::text||':'||p_brand||':'||p_platform,0));
 select * into before_row from public.marketing_accounts where user_id=p_owner and brand=p_brand and platform=p_platform for update;
 if before_row.id is distinct from p_expected_id or before_row.updated_at is distinct from p_expected_at then
  return intent||jsonb_build_object('kind','changed','id',before_row.id,'updatedAt',before_row.updated_at);end if;
 begin
  if before_row.id is not null then
   select jsonb_agg(to_jsonb(t)) into before_tokens from public.marketing_read_account_token(p_owner,before_row.id) t;
   if before_tokens is not null then
    if jsonb_array_length(before_tokens)<>1 or octet_length(before_tokens::text)>8192 then raise exception 'Unconfirmed';end if;
    before_token:=before_tokens->0;
    fingerprint:=jsonb_build_object('tokenHash',encode(sha256(convert_to(before_token->>'access_token','UTF8')),'hex'),
     'expiresAt',before_token->'expires_at','refreshedAt',before_token->'refreshed_at','scopes',before_token->'scopes','loginMode',before_token->'login_mode');
   end if;
  end if;
  if fingerprint is distinct from expected_fingerprint then
   return intent||jsonb_build_object('kind','changed','id',before_row.id,'updatedAt',before_row.updated_at);end if;
  identity_changed:=before_row.id is not null and (before_row.remote_account_id<>p_remote_account_id or lower(before_row.handle)<>lower(p_handle));
  should_store:=before_token is null or identity_changed or (before_token->>'expires_at')::timestamptz<=now()
   or before_token->>'login_mode'<>p_login_mode or p_expires_at>=(before_token->>'expires_at')::timestamptz;
  expected_enabled:=case when before_row.id is null or identity_changed then false else before_row.enabled end;
  expected_engagement:=case when before_row.id is null or identity_changed then false else before_row.engagement_enabled end;
  result:=public.marketing_verify_account(p_owner,p_brand,p_platform,p_remote_account_id,p_handle,p_token,p_expires_at,p_scopes,p_login_mode);
  if jsonb_typeof(result) is distinct from 'object' or not result?&array['accountId','remoteAccountId','handle','verifiedAt','enabled','tokenStored','token']
   or (result-array['accountId','remoteAccountId','handle','verifiedAt','enabled','tokenStored','token'])<>'{}'::jsonb then raise exception 'Unconfirmed';end if;
  select * into after_row from public.marketing_accounts where user_id=p_owner and brand=p_brand and platform=p_platform;
  if not found or result->>'accountId' is distinct from after_row.id::text or (before_row.id is not null and after_row.id<>before_row.id)
   or after_row.remote_account_id is distinct from p_remote_account_id or after_row.handle is distinct from p_handle
   or after_row.enabled is distinct from expected_enabled or after_row.verified_at is distinct from now()
   or result->'remoteAccountId' is distinct from to_jsonb(after_row.remote_account_id) or result->'handle' is distinct from to_jsonb(after_row.handle)
   or result->'verifiedAt' is distinct from to_jsonb(after_row.verified_at) or result->'enabled' is distinct from to_jsonb(after_row.enabled)
   or result->'tokenStored' is distinct from to_jsonb(should_store) then raise exception 'Unconfirmed';end if;
  if identity_changed and after_row.engagement_enabled then
   update public.marketing_accounts set engagement_enabled=false where id=after_row.id and user_id=p_owner;
   select * into after_row from public.marketing_accounts where id=after_row.id and user_id=p_owner;
  end if;
  if after_row.id is null or after_row.engagement_enabled is distinct from expected_engagement
   or after_row.remote_account_id is distinct from p_remote_account_id or after_row.handle is distinct from p_handle
   or after_row.enabled is distinct from expected_enabled or after_row.verified_at is distinct from now()
   or not isfinite(after_row.updated_at) or (p_expected_at is not null and after_row.updated_at<=p_expected_at)
   or (before_row.id is not null and (to_jsonb(after_row)-array['remote_account_id','handle','verified_at','enabled','engagement_enabled','updated_at'])
    is distinct from (to_jsonb(before_row)-array['remote_account_id','handle','verified_at','enabled','engagement_enabled','updated_at'])) then raise exception 'Unconfirmed';end if;
  select jsonb_agg(to_jsonb(t)) into after_tokens from public.marketing_read_account_token(p_owner,after_row.id) t;
  if after_tokens is null or jsonb_array_length(after_tokens)<>1 or octet_length(after_tokens::text)>8192 then raise exception 'Unconfirmed';end if;
  after_token:=after_tokens->0;
  if should_store then
   expected_token:=jsonb_build_object('access_token',p_token,'expires_at',p_expires_at,
    'refreshed_at',case when before_token->>'access_token'=p_token then (before_token->>'refreshed_at')::timestamptz else now() end,
    'scopes',to_jsonb(p_scopes),'login_mode',p_login_mode);
  else expected_token:=before_token;end if;
  if after_token is distinct from expected_token then raise exception 'Unconfirmed';end if;
  public_token:=jsonb_build_object('expiresAt',after_token->'expires_at','refreshedAt',after_token->'refreshed_at','scopes',after_token->'scopes','loginMode',after_token->'login_mode');
  if result->'token' is distinct from public_token then raise exception 'Unconfirmed';end if;
  -- Rebuild the public receipt. Neither a credential nor its fingerprint leaves this transaction.
  return intent||jsonb_build_object('kind','verified','id',after_row.id,'updatedAt',after_row.updated_at,'result',
   jsonb_build_object('accountId',after_row.id,'remoteAccountId',after_row.remote_account_id,'handle',after_row.handle,
    'verifiedAt',after_row.verified_at,'enabled',after_row.enabled,'tokenStored',should_store,'token',public_token));
 exception when others then raise exception 'Account verification unconfirmed' using errcode='40001';end;
end $$;
revoke all on function public.verify_owned_marketing_account(uuid,uuid,timestamptz,jsonb,text,text,text,text,text,timestamptz,text[],text) from public,anon,authenticated,service_role;
grant execute on function public.verify_owned_marketing_account(uuid,uuid,timestamptz,jsonb,text,text,text,text,text,timestamptz,text[],text) to service_role;
comment on function public.verify_owned_marketing_account(uuid,uuid,timestamptz,jsonb,text,text,text,text,text,timestamptz,text[],text) is
 'Captured owner/account/version and in-memory credential fingerprint; original lock order, exact persisted account/token proof and rollback. No credential or fingerprint in receipts. Service-only invoker; no table grants, policies, indexes or existing-row changes.';
