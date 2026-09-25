-- Bank provider abstraction — stop bank sync being one provider deep.
--
-- `bank_connections` was shaped around GoCardless: a requisition id and an
-- institution id, both NOT NULL. A token provider such as Fio has neither, and
-- the 90-day PSD2 consent lapse was not modelled at all — it only surfaced when
-- a sync happened to run and the requisition came back `EX`.
--
-- This migration is additive. Existing GoCardless rows keep working unchanged:
-- `provider_ref` is backfilled from `requisition_id`, and the GoCardless code
-- path still writes both.

alter table public.bank_connections
  alter column requisition_id drop not null;

alter table public.bank_connections
  alter column institution_id drop not null;

alter table public.bank_connections
  add column if not exists provider_ref text;

alter table public.bank_connections
  add column if not exists consent_expires_at timestamptz;

alter table public.bank_connections
  add column if not exists last_error text;

alter table public.bank_connections
  add column if not exists sync_cursor text;

update public.bank_connections
  set provider_ref = requisition_id
  where provider_ref is null and requisition_id is not null;

comment on column public.bank_connections.provider_ref is
  'Provider-neutral connection handle (a GoCardless requisition id, or null for a token provider with no upstream handle).';

comment on column public.bank_connections.consent_expires_at is
  'When the bank consent lapses. Null means the provider states no expiry — never a guess.';

comment on column public.bank_connections.last_error is
  'Short, non-sensitive reason the last sync failed. Never contains a token or a request URL.';

comment on column public.bank_connections.sync_cursor is
  'Provider-specific incremental cursor; currently the last successfully synced day.';

-- An unregistered provider value must fail at the database too, not only in
-- `src/lib/bank/registry.ts`.
alter table public.bank_connections
  drop constraint if exists bank_connections_provider_check;

alter table public.bank_connections
  add constraint bank_connections_provider_check
  check (provider in ('gocardless', 'fio', 'enable-banking'));

-- ----------------------------------------------------------------------------
-- Per-user provider secrets (today: the Fio read-only API token).
--
-- GoCardless is an app-level env pair, but a Fio token belongs to one person's
-- bank account, so it is user data. Same boundary as `github_tokens`: RLS on,
-- every grant revoked from anon and authenticated, service_role only. The value
-- is written by /api/bank/credentials and read only inside the sync; it never
-- appears in a response body, including /api/integrations/status.
-- ----------------------------------------------------------------------------
create table if not exists public.bank_provider_credentials (
  user_id    uuid not null references auth.users(id) on delete cascade,
  provider   text not null
    check (provider in ('gocardless', 'fio', 'enable-banking')),
  secret     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.bank_provider_credentials enable row level security;

revoke all on public.bank_provider_credentials from anon;
revoke all on public.bank_provider_credentials from authenticated;
grant all on public.bank_provider_credentials to service_role;

-- No policy is declared on purpose: with RLS enabled and no policy, anon and
-- authenticated can read nothing even if a grant were restored by accident.

create or replace function public.tg_bank_provider_credentials_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bank_provider_credentials_touch
  on public.bank_provider_credentials;
create trigger bank_provider_credentials_touch
  before update on public.bank_provider_credentials
  for each row execute function public.tg_bank_provider_credentials_touch();
