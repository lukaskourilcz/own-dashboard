create table if not exists public.saved_job_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid references public.job_listings(id) on delete set null,
  title text not null,
  company text,
  url text not null,
  source text,
  location text,
  description text,
  cover_letter text not null default '',
  notes text,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, url)
);

create index if not exists saved_job_positions_user_saved_idx
  on public.saved_job_positions (user_id, saved_at desc);

alter table public.saved_job_positions enable row level security;

grant select, insert, update, delete on public.saved_job_positions to authenticated;
grant select, insert, update, delete on public.saved_job_positions to service_role;

create policy "saved_job_positions select own"
  on public.saved_job_positions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "saved_job_positions insert own"
  on public.saved_job_positions for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "saved_job_positions update own"
  on public.saved_job_positions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "saved_job_positions delete own"
  on public.saved_job_positions for delete to authenticated
  using ((select auth.uid()) = user_id);
