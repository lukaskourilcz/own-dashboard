-- Reserve explicit local removal against the same source version used by
-- refresh. An external revoke is not a database transaction; report its own
-- outcome separately. Applying this migration revokes no existing grant.
create function public.claim_oauth_revocation(p_user_id uuid,p_provider text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  table_name text; source_row jsonb; reserved public.oauth_refresh_leases%rowtype; lease uuid; deadline timestamptz;
begin
  table_name := case p_provider when 'google' then 'google_oauth' when 'github' then 'github_tokens' end;
  if p_user_id is null or table_name is null then raise exception 'Invalid OAuth refresh request'; end if;
  execute format('select to_jsonb(t) from public.%I t where user_id=$1 for update',table_name) into source_row using p_user_id;
  if source_row is null then return jsonb_build_object('state','disconnected'); end if;
  select * into reserved from public.oauth_refresh_leases where user_id=p_user_id and provider=p_provider for update;
  if found and reserved.expires_at>clock_timestamp() and reserved.source_version=md5(source_row::text) then
    return jsonb_build_object('state','busy');
  end if;
  lease := gen_random_uuid(); deadline := clock_timestamp()+interval '60 seconds';
  insert into public.oauth_refresh_leases(user_id,provider,lease_id,expires_at,source_version)
    values(p_user_id,p_provider,lease,deadline,md5(source_row::text))
    on conflict(user_id,provider) do update set lease_id=excluded.lease_id,expires_at=excluded.expires_at,source_version=excluded.source_version;
  if not exists(select 1 from public.oauth_refresh_leases where user_id=p_user_id and provider=p_provider and lease_id=lease and expires_at=deadline and source_version=md5(source_row::text)) then
    raise exception 'OAuth reservation unconfirmed';
  end if;
  return jsonb_build_object('state','claimed','lease_id',lease,'row',source_row);
end $$;
revoke all on function public.claim_oauth_revocation(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_oauth_revocation(uuid,text) to service_role;

create function public.complete_oauth_revocation(p_user_id uuid,p_provider text,p_lease_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select public.complete_oauth_refresh(p_user_id,p_provider,p_lease_id,null::text,null::text,null::timestamptz,'{}'::text[],true)
$$;
revoke all on function public.complete_oauth_revocation(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.complete_oauth_revocation(uuid,text,uuid) to service_role;
