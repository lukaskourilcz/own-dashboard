-- Private platform profiles and reviewed freelance leads; no credentials or automatic submissions.
create table public.freelance_platforms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  url text not null check (url ~ '^https://'),
  search_url text not null check (search_url ~ '^https://'),
  registration_url text check (registration_url ~ '^https://'),
  profile_url text check (profile_url ~ '^https://'),
  kind text not null default 'marketplace' check (kind in ('marketplace','services','directory','leads','vetted')),
  profile_status text not null default 'draft' check (profile_status in ('draft','needs_login','needs_verification','terms_pending','published','paused')),
  profile_title text not null default '',
  profile_text text not null default '',
  services text not null default '',
  fee_notes text not null default '',
  notes text not null default '',
  evidence_url text check (evidence_url ~ '^https://'),
  checked_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name), unique (user_id, id),
  check (profile_status <> 'published' or profile_url is not null)
);
alter table public.freelance_platforms enable row level security;
create policy freelance_platforms_own on public.freelance_platforms for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.freelance_platforms to authenticated;

alter table public.client_opportunities
  add column platform_id uuid,
  add column remote_scope text not null default 'unknown' check (remote_scope in ('worldwide','europe','czechia','restricted','unknown','onsite')),
  add column eligibility text not null default 'needs_review' check (eligibility in ('verified','needs_review','not_suitable')),
  add column stack text[] not null default '{}',
  add column match_notes text not null default '',
  add column proposal_text text not null default '',
  add column proposal_url text check (proposal_url ~ '^https://'),
  add column submitted_on date,
  add column responded_on date,
  add column checked_on date,
  add constraint opportunity_platform_owner foreign key (user_id, platform_id) references public.freelance_platforms(user_id,id),
  add constraint opportunity_response_order check (responded_on is null or (submitted_on is not null and responded_on >= submitted_on));
create index client_opportunities_platform_idx on public.client_opportunities(user_id, platform_id);
create unique index client_opportunities_platform_source_unique on public.client_opportunities(user_id, platform_id, source_url)
  where platform_id is not null and source_url is not null;

create table public.opportunity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.client_opportunities(id) on delete cascade,
  previous_status text,
  status text not null,
  submitted_on date,
  responded_on date,
  created_at timestamptz not null default now()
);
create index opportunity_events_owner_time_idx on public.opportunity_events(user_id, opportunity_id, created_at desc);
alter table public.opportunity_events enable row level security;
create policy opportunity_events_read on public.opportunity_events for select to authenticated using ((select auth.uid()) = user_id);
-- Audit writes happen only in the trigger; clients cannot forge or edit history.
revoke all on public.opportunity_events from anon, authenticated;
grant select on public.opportunity_events to authenticated;
create function public.audit_freelance_opportunity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.opportunity_events(user_id,opportunity_id,status,submitted_on,responded_on)
    values(new.user_id,new.id,new.status,new.submitted_on,new.responded_on);
  elsif (old.status,old.submitted_on,old.responded_on) is distinct from (new.status,new.submitted_on,new.responded_on) then
    insert into public.opportunity_events(user_id,opportunity_id,previous_status,status,submitted_on,responded_on)
    values(new.user_id,new.id,old.status,new.status,new.submitted_on,new.responded_on);
  end if;
  return new;
end;
$$;
revoke all on function public.audit_freelance_opportunity() from public, anon, authenticated;
create trigger audit_freelance_opportunity after insert or update on public.client_opportunities
  for each row execute function public.audit_freelance_opportunity();
