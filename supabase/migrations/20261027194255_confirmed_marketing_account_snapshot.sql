-- One captured authenticated-owner snapshot; no token value is selected or returned.
create function public.read_owned_marketing_accounts(p_owner uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_owner is null then raise exception 'Account snapshot invalid' using errcode='22023';end if;
 if current_user<>'authenticated' or (select auth.uid()) is distinct from p_owner then
  raise exception 'Account snapshot unavailable' using errcode='42501';end if;
 with accounts as (
  select a.id,a.user_id,a.brand,a.platform,a.handle,a.verified_at,a.enabled,
   a.engagement_enabled,a.engagement_blocked_code,a.engagement_blocked_at
  from public.marketing_accounts a where a.user_id=p_owner
 ), tokens as (
  select t.account_id,t.brand,t.platform,t.expires_at,t.refreshed_at,t.scopes,t.login_mode
  from public.marketing_account_token_status() t
 )
 select jsonb_build_object('ownerId',p_owner,
  'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by a.brand,a.platform,a.id) from accounts a),'[]'::jsonb),
  'tokens',coalesce((select jsonb_agg(to_jsonb(t) order by t.brand,t.platform,t.account_id) from tokens t),'[]'::jsonb))
 into result;
 if jsonb_array_length(result->'accounts')>4 or jsonb_array_length(result->'tokens')>4 or octet_length(result::text)>20000 then
  raise exception 'Account snapshot unavailable' using errcode='40001';end if;
 return result;
end $$;
revoke all on function public.read_owned_marketing_accounts(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_owned_marketing_accounts(uuid) to authenticated;
comment on function public.read_owned_marketing_accounts(uuid) is
 'Read-only captured authenticated-owner account/token-metadata snapshot under own RLS; stable invoker, no credentials, writes, policies or table grants.';
