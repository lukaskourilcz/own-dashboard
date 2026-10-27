-- Captured control foundation; API/browser adoption follows before deployment.
set lock_timeout='5s';
alter table public.marketing_accounts add column updated_at timestamptz not null default clock_timestamp();
alter table public.marketing_accounts add constraint marketing_accounts_finite_version
 check(isfinite(updated_at) and extract(year from updated_at) between 1 and 9999) not valid;
alter table public.marketing_accounts validate constraint marketing_accounts_finite_version;
create function public.marketing_account_version_touch() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 return new;
end $$;
revoke all on function public.marketing_account_version_touch() from public,anon,authenticated,service_role;
create trigger marketing_account_version_touch before update on public.marketing_accounts
 for each row execute function public.marketing_account_version_touch();

create function public.toggle_owned_marketing_account(p_owner uuid,p_id uuid,p_expected_at timestamptz,p_switch text,p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare before_row public.marketing_accounts;written_row public.marketing_accounts;after_row public.marketing_accounts;
 intent jsonb;metadata jsonb;token jsonb;required_scopes text[];scope_name text;expires timestamptz;code text;
begin
 if current_user<>'service_role' then raise exception 'Account control unavailable' using errcode='42501';end if;
 if p_owner is null or p_id is null or p_expected_at is null or not isfinite(p_expected_at)
  or extract(year from p_expected_at) not between 1 and 9999 or p_enabled is null
  or p_switch is null or p_switch not in('publishing','engagement') then
  raise exception 'Account control invalid' using errcode='22023';end if;
 intent:=jsonb_build_object('ownerId',p_owner,'id',p_id,'expectedVersion',p_expected_at,'switch',p_switch,'requestedEnabled',p_enabled);
 -- Existing token verification/update functions take SHARE/UPDATE on this account first.
 -- Holding UPDATE retains the same lock order and prevents their eligibility changes until commit.
 select * into before_row from public.marketing_accounts where id=p_id and user_id=p_owner for update;
 if not found or (p_switch='engagement' and (before_row.brand<>'dneskai' or before_row.platform<>'instagram')) then
  return intent||jsonb_build_object('kind','absent','updatedAt',null);end if;
 if before_row.updated_at<>p_expected_at then
  return intent||jsonb_build_object('kind','changed','updatedAt',before_row.updated_at);end if;
 if p_enabled then
  if before_row.verified_at is null then code:='account-not-verified';
  elsif not isfinite(before_row.verified_at) or extract(year from before_row.verified_at) not between 1 and 9999 then
   raise exception 'Account control unconfirmed' using errcode='40001';
  else
   select jsonb_agg(jsonb_build_object('brand',t.brand,'platform',t.platform,'expiresAt',t.expires_at,
    'refreshedAt',t.refreshed_at,'scopes',to_jsonb(t.scopes),'loginMode',t.login_mode))
    into metadata from public.marketing_account_token_metadata(p_owner) t where t.account_id=p_id;
   if metadata is null then code:='access-token-missing';
   else
    if jsonb_array_length(metadata)<>1 or octet_length(metadata::text)>4096 then
     raise exception 'Account control unconfirmed' using errcode='40001';end if;
    token:=metadata->0;expires:=(token->>'expiresAt')::timestamptz;
    if token->>'brand' is distinct from before_row.brand or token->>'platform' is distinct from before_row.platform or expires is null or not isfinite(expires)
     or extract(year from expires) not between 1 and 9999 or token->>'loginMode' is null or token->>'loginMode' not in('instagram','facebook','threads')
     or ((before_row.platform='threads')<>(token->>'loginMode'='threads'))
     or jsonb_typeof(token->'scopes') is distinct from 'array' then
     raise exception 'Account control unconfirmed' using errcode='40001';end if;
    if jsonb_array_length(token->'scopes')>20
     or exists(select 1 from jsonb_array_elements(token->'scopes') s where jsonb_typeof(s)<>'string' or s#>>'{}' !~ '^[a-z_]{1,64}$')
     or (select count(distinct s) from jsonb_array_elements_text(token->'scopes') s)<>jsonb_array_length(token->'scopes') then
     raise exception 'Account control unconfirmed' using errcode='40001';end if;
    if expires<=clock_timestamp() then code:='access-token-expired';
    elsif p_switch='engagement' then
     required_scopes:=case when token->>'loginMode'='facebook' then array['instagram_basic','instagram_manage_comments','pages_messaging']
      else array['instagram_business_basic','instagram_business_manage_comments'] end;
     foreach scope_name in array required_scopes loop
      if not (token->'scopes')?scope_name then code:='engagement-scopes-unverified';end if;
     end loop;
    end if;
   end if;
  end if;
  if code is not null then return intent||jsonb_build_object('kind','blocked','updatedAt',before_row.updated_at,'code',code);end if;
 end if;
 if p_switch='publishing' then
  update public.marketing_accounts set enabled=p_enabled where id=p_id and user_id=p_owner and updated_at=p_expected_at returning * into written_row;
 else
  update public.marketing_accounts set engagement_enabled=p_enabled,
   engagement_blocked_code=case when p_enabled then null else engagement_blocked_code end,
   engagement_blocked_at=case when p_enabled then null else engagement_blocked_at end
   where id=p_id and user_id=p_owner and updated_at=p_expected_at returning * into written_row;
 end if;
 if not found then raise exception 'Account control unconfirmed' using errcode='40001';end if;
 select * into after_row from public.marketing_accounts where id=p_id and user_id=p_owner;
 if not found or after_row is distinct from written_row or not isfinite(after_row.updated_at) or after_row.updated_at<=p_expected_at then
  raise exception 'Account control unconfirmed' using errcode='40001';end if;
 if p_switch='publishing' then
  if after_row.enabled is distinct from p_enabled
   or (to_jsonb(after_row)-'enabled'-'updated_at') is distinct from (to_jsonb(before_row)-'enabled'-'updated_at') then
   raise exception 'Account control unconfirmed' using errcode='40001';end if;
 else
  if after_row.engagement_enabled is distinct from p_enabled
   or after_row.engagement_blocked_code is distinct from (case when p_enabled then null else before_row.engagement_blocked_code end)
   or after_row.engagement_blocked_at is distinct from (case when p_enabled then null else before_row.engagement_blocked_at end)
   or (to_jsonb(after_row)-'engagement_enabled'-'engagement_blocked_code'-'engagement_blocked_at'-'updated_at')
    is distinct from (to_jsonb(before_row)-'engagement_enabled'-'engagement_blocked_code'-'engagement_blocked_at'-'updated_at') then
   raise exception 'Account control unconfirmed' using errcode='40001';end if;
 end if;
 return intent||jsonb_build_object('kind','saved','updatedAt',after_row.updated_at);
end $$;
revoke all on function public.toggle_owned_marketing_account(uuid,uuid,timestamptz,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.toggle_owned_marketing_account(uuid,uuid,timestamptz,text,boolean) to service_role;
comment on function public.toggle_owned_marketing_account(uuid,uuid,timestamptz,text,boolean) is
 'Service-only captured account switch; current eligibility under account lock, fixed scoped receipts and post-trigger persisted-row proof. No provider action. Uncertain retries require a fresh read.';
