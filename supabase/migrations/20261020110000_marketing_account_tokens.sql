-- One current long-lived Meta access token per marketing account (#121).
--
-- No browser role and not even the service-role client can read or write this
-- table directly: RLS is enabled with no policy and every table privilege is
-- revoked. The token value is reachable only through the security-definer
-- functions below, which only service_role may execute. The owner reads
-- non-secret metadata (expiry, refresh time, scopes, login mode) through
-- marketing_account_token_status().
create table public.marketing_account_tokens (
  account_id uuid primary key references public.marketing_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token text not null check (char_length(access_token) between 20 and 4096 and access_token !~ '\s'),
  expires_at timestamptz not null,
  -- When this exact token value was stored here, after verification or a refresh.
  -- It is a lower bound for the token's age, so the 24-hour refresh rule is never broken.
  refreshed_at timestamptz not null,
  scopes text[] not null default '{}' check (cardinality(scopes) <= 20),
  login_mode text not null check (login_mode in ('instagram','facebook','threads')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.marketing_account_tokens enable row level security;
revoke all on public.marketing_account_tokens from public, anon, authenticated, service_role;

-- Ownership and login mode are checked even for the privileged functions.
create function public.marketing_account_tokens_guard() returns trigger language plpgsql set search_path='' as $$
declare a public.marketing_accounts;
begin
 select * into a from public.marketing_accounts where id=new.account_id;
 if not found or a.user_id<>new.user_id then raise exception 'foreign account'; end if;
 if (a.platform='threads')<>(new.login_mode='threads') then raise exception 'login mode mismatch'; end if;
 if exists(select 1 from unnest(new.scopes) s where s !~ '^[a-z_]{1,64}$') then raise exception 'invalid scope'; end if;
 new.updated_at:=now();
 return new;
end $$;
revoke all on function public.marketing_account_tokens_guard() from public,anon,authenticated,service_role;
create trigger marketing_account_tokens_guard before insert or update on public.marketing_account_tokens
 for each row execute function public.marketing_account_tokens_guard();

create function public.marketing_account_token_metadata_json(t public.marketing_account_tokens) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('expiresAt',t.expires_at,'refreshedAt',t.refreshed_at,'scopes',to_jsonb(t.scopes),'loginMode',t.login_mode);
$$;
revoke all on function public.marketing_account_token_metadata_json(public.marketing_account_tokens) from public,anon,authenticated,service_role;

-- The verified account row and its bootstrap token commit together. A token
-- that is still valid and expires later than the submitted one (a refreshed
-- token) is kept, so re-verifying with the older bootstrap value never
-- regresses it. A changed remote identity disables the account and replaces
-- the token.
create function public.marketing_verify_account(p_owner uuid,p_brand text,p_platform text,p_remote_account_id text,p_handle text,
 p_token text,p_expires_at timestamptz,p_scopes text[],p_login_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.marketing_accounts; t public.marketing_account_tokens; identity_changed boolean:=false; stored boolean:=false;
begin
 if p_owner is null or p_brand not in ('dneskai','devshark') or p_platform not in ('instagram','threads') then raise exception 'invalid account'; end if;
 if p_remote_account_id is null or p_remote_account_id !~ '^[0-9]{1,100}$' or p_handle is null or p_handle !~ '^[A-Za-z0-9._]{1,30}$' then raise exception 'invalid account'; end if;
 if p_expires_at is null or p_expires_at<=now() then raise exception 'token expired'; end if;
 perform pg_advisory_xact_lock(hashtextextended('marketing-account:'||p_owner::text||':'||p_brand||':'||p_platform,0));
 select * into a from public.marketing_accounts where user_id=p_owner and brand=p_brand and platform=p_platform for update;
 if found then
  identity_changed:=a.remote_account_id<>p_remote_account_id or lower(a.handle)<>lower(p_handle);
  update public.marketing_accounts set remote_account_id=p_remote_account_id,handle=p_handle,verified_at=now(),
   enabled=case when identity_changed then false else a.enabled end where id=a.id returning * into a;
 else
  insert into public.marketing_accounts(user_id,brand,platform,remote_account_id,handle,verified_at,enabled)
  values(p_owner,p_brand,p_platform,p_remote_account_id,p_handle,now(),false) returning * into a;
 end if;
 select * into t from public.marketing_account_tokens where account_id=a.id for update;
 if not found then
  insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode)
  values(a.id,p_owner,p_token,p_expires_at,now(),coalesce(p_scopes,'{}'),p_login_mode) returning * into t;
  stored:=true;
 elsif identity_changed or t.expires_at<=now() or t.login_mode<>p_login_mode or p_expires_at>=t.expires_at then
  update public.marketing_account_tokens set access_token=p_token,expires_at=p_expires_at,
   refreshed_at=case when t.access_token=p_token then t.refreshed_at else now() end,
   scopes=coalesce(p_scopes,'{}'),login_mode=p_login_mode where account_id=a.id returning * into t;
  stored:=true;
 end if;
 return jsonb_build_object('accountId',a.id,'remoteAccountId',a.remote_account_id,'handle',a.handle,'verifiedAt',a.verified_at,
  'enabled',a.enabled,'tokenStored',stored,'token',public.marketing_account_token_metadata_json(t));
end $$;
revoke all on function public.marketing_verify_account(uuid,text,text,text,text,text,timestamptz,text[],text) from public,anon,authenticated;
grant execute on function public.marketing_verify_account(uuid,text,text,text,text,text,timestamptz,text[],text) to service_role;

-- Stores a refreshed (or first) token. An existing row is replaced only when
-- the caller presents the refreshed_at it read (compare-and-set), so two
-- concurrent refreshes cannot overwrite each other silently.
create function public.marketing_store_account_token(p_owner uuid,p_account uuid,p_expected_refreshed_at timestamptz,
 p_token text,p_expires_at timestamptz,p_scopes text[],p_login_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.marketing_accounts; t public.marketing_account_tokens;
begin
 select * into a from public.marketing_accounts where id=p_account and user_id=p_owner for share;
 if not found then raise exception 'account unavailable'; end if;
 if p_expires_at is null or p_expires_at<=now() then raise exception 'token expired'; end if;
 select * into t from public.marketing_account_tokens where account_id=a.id for update;
 if found then
  if p_expected_refreshed_at is null or t.refreshed_at<>p_expected_refreshed_at then raise exception 'token changed'; end if;
  update public.marketing_account_tokens set access_token=p_token,expires_at=p_expires_at,refreshed_at=now(),
   scopes=coalesce(p_scopes,t.scopes),login_mode=p_login_mode where account_id=a.id returning * into t;
 else
  if p_expected_refreshed_at is not null then raise exception 'token changed'; end if;
  insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode)
  values(a.id,p_owner,p_token,p_expires_at,now(),coalesce(p_scopes,'{}'),p_login_mode) returning * into t;
 end if;
 return jsonb_build_object('accountId',a.id,'token',public.marketing_account_token_metadata_json(t));
end $$;
revoke all on function public.marketing_store_account_token(uuid,uuid,timestamptz,text,timestamptz,text[],text) from public,anon,authenticated;
grant execute on function public.marketing_store_account_token(uuid,uuid,timestamptz,text,timestamptz,text[],text) to service_role;

-- The only read of the token value. Server-side publisher and refresh code only.
create function public.marketing_read_account_token(p_owner uuid,p_account uuid)
returns table(access_token text,expires_at timestamptz,refreshed_at timestamptz,scopes text[],login_mode text)
language sql stable security definer set search_path='' as $$
 select t.access_token,t.expires_at,t.refreshed_at,t.scopes,t.login_mode
 from public.marketing_account_tokens t join public.marketing_accounts a on a.id=t.account_id
 where t.account_id=p_account and t.user_id=p_owner and a.user_id=p_owner;
$$;
revoke all on function public.marketing_read_account_token(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_read_account_token(uuid,uuid) to service_role;

-- Non-secret metadata for a scheduler (#120) that decides which tokens to refresh.
create function public.marketing_account_token_metadata(p_owner uuid)
returns table(account_id uuid,brand text,platform text,expires_at timestamptz,refreshed_at timestamptz,scopes text[],login_mode text)
language sql stable security definer set search_path='' as $$
 select a.id,a.brand,a.platform,t.expires_at,t.refreshed_at,t.scopes,t.login_mode
 from public.marketing_accounts a join public.marketing_account_tokens t on t.account_id=a.id and t.user_id=a.user_id
 where a.user_id=p_owner order by a.brand,a.platform;
$$;
revoke all on function public.marketing_account_token_metadata(uuid) from public,anon,authenticated;
grant execute on function public.marketing_account_token_metadata(uuid) to service_role;

-- The owner's own non-secret token metadata. There is no token column here.
create function public.marketing_account_token_status()
returns table(account_id uuid,brand text,platform text,expires_at timestamptz,refreshed_at timestamptz,scopes text[],login_mode text)
language sql stable security definer set search_path='' as $$
 select a.id,a.brand,a.platform,t.expires_at,t.refreshed_at,t.scopes,t.login_mode
 from public.marketing_accounts a join public.marketing_account_tokens t on t.account_id=a.id and t.user_id=a.user_id
 where a.user_id=(select auth.uid()) order by a.brand,a.platform;
$$;
revoke all on function public.marketing_account_token_status() from public,anon,authenticated;
grant execute on function public.marketing_account_token_status() to authenticated;
