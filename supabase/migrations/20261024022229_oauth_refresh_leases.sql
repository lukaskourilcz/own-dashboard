-- Persist the refresh reservation across the provider HTTP request. Existing
-- transaction locks finish at the RPC response and cannot protect that request.
-- This creates no grant and changes no existing credential on migration apply.
create table public.oauth_refresh_leases (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google','github')),
  lease_id uuid not null,
  expires_at timestamptz not null,
  source_version text not null,
  primary key (user_id,provider)
);
alter table public.oauth_refresh_leases enable row level security;
revoke all on public.oauth_refresh_leases from public,anon,authenticated;
grant all on public.oauth_refresh_leases to service_role;

create function public.claim_oauth_refresh(p_user_id uuid,p_provider text,p_failed_token text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  table_name text; source_row jsonb; reserved public.oauth_refresh_leases%rowtype; lease uuid; deadline timestamptz;
begin
  table_name := case p_provider when 'google' then 'google_oauth' when 'github' then 'github_tokens' end;
  if p_user_id is null or table_name is null then raise exception 'Invalid OAuth refresh request'; end if;
  execute format('select to_jsonb(t) from public.%I t where user_id=$1 for update',table_name) into source_row using p_user_id;
  if source_row is null then return jsonb_build_object('state','disconnected'); end if;
  if nullif(source_row->>'access_token','') is not null and (
    (p_provider='github' and source_row->>'expires_at' is null and source_row->>'refresh_token' is null)
    or ((source_row->>'expires_at')::timestamptz > clock_timestamp()+interval '60 seconds'
      and (p_failed_token is null or source_row->>'access_token' is distinct from p_failed_token))
  ) then return jsonb_build_object('state','cached','row',source_row); end if;
  if nullif(source_row->>'refresh_token','') is null then return jsonb_build_object('state','disconnected'); end if;
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
revoke all on function public.claim_oauth_refresh(uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_oauth_refresh(uuid,text,text) to service_role;

create function public.complete_oauth_refresh(p_user_id uuid,p_provider text,p_lease_id uuid,
  p_access_token text,p_refresh_token text,p_expires_at timestamptz,p_scopes text[],p_invalid_grant boolean default false)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  table_name text; source_row jsonb; confirmed jsonb; reserved public.oauth_refresh_leases%rowtype;
  expected jsonb; affected integer;
begin
  table_name := case p_provider when 'google' then 'google_oauth' when 'github' then 'github_tokens' end;
  if p_user_id is null or table_name is null or p_lease_id is null or p_invalid_grant is null then raise exception 'Invalid OAuth refresh completion'; end if;
  if not p_invalid_grant and (p_access_token is null or length(p_access_token) not between 1 and 8192
    or (p_refresh_token is not null and length(p_refresh_token) not between 1 and 8192)
    or (p_provider='google' and p_expires_at is null)
    or (p_expires_at is not null and p_expires_at<=clock_timestamp())
    or p_scopes is null or cardinality(p_scopes)>100
    or exists(select 1 from unnest(p_scopes) as scope where scope is null or length(scope) not between 1 and 500)) then
    raise exception 'Invalid OAuth refresh completion';
  end if;
  execute format('select to_jsonb(t) from public.%I t where user_id=$1 for update',table_name) into source_row using p_user_id;
  select * into reserved from public.oauth_refresh_leases where user_id=p_user_id and provider=p_provider for update;
  if source_row is null or not found or reserved.lease_id<>p_lease_id or reserved.expires_at<=clock_timestamp()
    or reserved.source_version<>md5(source_row::text) then return false; end if;
  if p_invalid_grant then
    execute format('delete from public.%I where user_id=$1 returning to_jsonb(%I)',table_name,table_name) into confirmed using p_user_id;
    if confirmed is null then raise exception 'OAuth removal unconfirmed'; end if;
  else
    expected := source_row || jsonb_build_object('access_token',p_access_token,'refresh_token',coalesce(p_refresh_token,source_row->>'refresh_token'),
      'expires_at',p_expires_at,'scopes',to_jsonb(p_scopes));
    execute format('update public.%I set access_token=$2,refresh_token=coalesce($3,refresh_token),expires_at=$4,scopes=$5,updated_at=clock_timestamp() where user_id=$1 returning to_jsonb(%I)',table_name,table_name)
      into confirmed using p_user_id,p_access_token,p_refresh_token,p_expires_at,p_scopes;
    if confirmed is null or (confirmed-'updated_at') is distinct from (expected-'updated_at') then raise exception 'OAuth refresh write unconfirmed'; end if;
  end if;
  delete from public.oauth_refresh_leases where user_id=p_user_id and provider=p_provider and lease_id=p_lease_id;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'OAuth refresh completion unconfirmed'; end if;
  return true;
end $$;
revoke all on function public.complete_oauth_refresh(uuid,text,uuid,text,text,timestamptz,text[],boolean) from public,anon,authenticated;
grant execute on function public.complete_oauth_refresh(uuid,text,uuid,text,text,timestamptz,text[],boolean) to service_role;
