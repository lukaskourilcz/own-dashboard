-- Personal Dashboard schema
-- Run this in the Supabase SQL editor.

-- =============================================================
-- Subscriptions
-- =============================================================
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'USD',
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly', 'weekly')),
  category text,
  next_billing_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Section 6 migration: existing installs need the column too.
alter table public.subscriptions
  add column if not exists is_active boolean not null default true;

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions select own" on public.subscriptions;
create policy "subscriptions select own" on public.subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "subscriptions insert own" on public.subscriptions;
create policy "subscriptions insert own" on public.subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "subscriptions update own" on public.subscriptions;
create policy "subscriptions update own" on public.subscriptions
  for update using (auth.uid() = user_id);

drop policy if exists "subscriptions delete own" on public.subscriptions;
create policy "subscriptions delete own" on public.subscriptions
  for delete using (auth.uid() = user_id);

-- =============================================================
-- Todos
-- =============================================================
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  due_date date,
  created_at timestamptz not null default now()
);

alter table public.todos enable row level security;

drop policy if exists "todos select own" on public.todos;
create policy "todos select own" on public.todos
  for select using (auth.uid() = user_id);

drop policy if exists "todos insert own" on public.todos;
create policy "todos insert own" on public.todos
  for insert with check (auth.uid() = user_id);

drop policy if exists "todos update own" on public.todos;
create policy "todos update own" on public.todos
  for update using (auth.uid() = user_id);

drop policy if exists "todos delete own" on public.todos;
create policy "todos delete own" on public.todos
  for delete using (auth.uid() = user_id);

-- =============================================================
-- Streaks (skills tracked daily)
-- =============================================================
create table if not exists public.streaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#10b981',
  reminder_time time,
  created_at timestamptz not null default now()
);

-- Section 5 migration: existing installs need the reminder_time column.
alter table public.streaks
  add column if not exists reminder_time time;

alter table public.streaks enable row level security;

drop policy if exists "streaks select own" on public.streaks;
create policy "streaks select own" on public.streaks
  for select using (auth.uid() = user_id);

drop policy if exists "streaks insert own" on public.streaks;
create policy "streaks insert own" on public.streaks
  for insert with check (auth.uid() = user_id);

drop policy if exists "streaks update own" on public.streaks;
create policy "streaks update own" on public.streaks
  for update using (auth.uid() = user_id);

drop policy if exists "streaks delete own" on public.streaks;
create policy "streaks delete own" on public.streaks
  for delete using (auth.uid() = user_id);

create table if not exists public.streak_logs (
  id uuid primary key default gen_random_uuid(),
  streak_id uuid not null references public.streaks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  created_at timestamptz not null default now(),
  unique (streak_id, log_date)
);

alter table public.streak_logs enable row level security;

drop policy if exists "streak_logs select own" on public.streak_logs;
create policy "streak_logs select own" on public.streak_logs
  for select using (auth.uid() = user_id);

drop policy if exists "streak_logs insert own" on public.streak_logs;
create policy "streak_logs insert own" on public.streak_logs
  for insert with check (auth.uid() = user_id);

drop policy if exists "streak_logs delete own" on public.streak_logs;
create policy "streak_logs delete own" on public.streak_logs
  for delete using (auth.uid() = user_id);

-- =============================================================
-- Section 2: Finances (accounts + transactions)
-- =============================================================
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  balance numeric(14, 2) not null default 0,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accounts enable row level security;

drop policy if exists "accounts select own" on public.accounts;
create policy "accounts select own" on public.accounts
  for select using (auth.uid() = user_id);

drop policy if exists "accounts insert own" on public.accounts;
create policy "accounts insert own" on public.accounts
  for insert with check (auth.uid() = user_id);

drop policy if exists "accounts update own" on public.accounts;
create policy "accounts update own" on public.accounts
  for update using (auth.uid() = user_id);

drop policy if exists "accounts delete own" on public.accounts;
create policy "accounts delete own" on public.accounts
  for delete using (auth.uid() = user_id);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  kind text not null check (kind in ('income', 'expense')),
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'USD',
  category text,
  note text,
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_occurred_idx
  on public.transactions (user_id, occurred_on desc);

alter table public.transactions enable row level security;

drop policy if exists "transactions select own" on public.transactions;
create policy "transactions select own" on public.transactions
  for select using (auth.uid() = user_id);

drop policy if exists "transactions insert own" on public.transactions;
create policy "transactions insert own" on public.transactions
  for insert with check (auth.uid() = user_id);

drop policy if exists "transactions update own" on public.transactions;
create policy "transactions update own" on public.transactions
  for update using (auth.uid() = user_id);

drop policy if exists "transactions delete own" on public.transactions;
create policy "transactions delete own" on public.transactions
  for delete using (auth.uid() = user_id);

-- =============================================================
-- Section 3: Plans (long-horizon goals)
-- =============================================================
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  target_date date,
  status text not null default 'idea' check (status in ('idea', 'active', 'done', 'dropped')),
  notes text,
  linked_calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plans enable row level security;

drop policy if exists "plans select own" on public.plans;
create policy "plans select own" on public.plans
  for select using (auth.uid() = user_id);

drop policy if exists "plans insert own" on public.plans;
create policy "plans insert own" on public.plans
  for insert with check (auth.uid() = user_id);

drop policy if exists "plans update own" on public.plans;
create policy "plans update own" on public.plans
  for update using (auth.uid() = user_id);

drop policy if exists "plans delete own" on public.plans;
create policy "plans delete own" on public.plans
  for delete using (auth.uid() = user_id);

-- =============================================================
-- Couples mode: pairing + sharing preferences + profiles
-- =============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles select" on public.profiles;
create policy "profiles select" on public.profiles
  for select using (
    auth.uid() = id
    or exists (
      select 1 from public.couples c
      where (c.user_a_id = auth.uid() and c.user_b_id = profiles.id)
         or (c.user_b_id = auth.uid() and c.user_a_id = profiles.id)
    )
  );

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = id);

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a_id <> user_b_id),
  unique (user_a_id, user_b_id)
);

alter table public.couples enable row level security;

drop policy if exists "couples select members" on public.couples;
create policy "couples select members" on public.couples
  for select using (auth.uid() in (user_a_id, user_b_id));

drop policy if exists "couples insert members" on public.couples;
create policy "couples insert members" on public.couples
  for insert with check (auth.uid() in (user_a_id, user_b_id));

drop policy if exists "couples delete members" on public.couples;
create policy "couples delete members" on public.couples
  for delete using (auth.uid() in (user_a_id, user_b_id));

create table if not exists public.couple_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);

create index if not exists couple_invites_invitee_email_idx
  on public.couple_invites (lower(invitee_email));

alter table public.couple_invites enable row level security;

-- Sender sees their sent invites; recipient sees ones addressed to their email.
drop policy if exists "couple_invites select" on public.couple_invites;
create policy "couple_invites select" on public.couple_invites
  for select using (
    auth.uid() = inviter_id
    or lower(invitee_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "couple_invites insert sender" on public.couple_invites;
create policy "couple_invites insert sender" on public.couple_invites
  for insert with check (auth.uid() = inviter_id);

-- Either side can update status (sender to cancel, recipient to accept/decline).
drop policy if exists "couple_invites update either" on public.couple_invites;
create policy "couple_invites update either" on public.couple_invites
  for update using (
    auth.uid() = inviter_id
    or lower(invitee_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "couple_invites delete sender" on public.couple_invites;
create policy "couple_invites delete sender" on public.couple_invites
  for delete using (auth.uid() = inviter_id);

create table if not exists public.sharing_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  share_subscriptions boolean not null default false,
  share_todos boolean not null default false,
  share_streaks boolean not null default false,
  share_finances boolean not null default false,
  share_plans boolean not null default false,
  share_books boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.sharing_prefs enable row level security;

drop policy if exists "sharing_prefs select" on public.sharing_prefs;
create policy "sharing_prefs select" on public.sharing_prefs
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.couples c
      where (c.user_a_id = auth.uid() and c.user_b_id = sharing_prefs.user_id)
         or (c.user_b_id = auth.uid() and c.user_a_id = sharing_prefs.user_id)
    )
  );

drop policy if exists "sharing_prefs insert own" on public.sharing_prefs;
create policy "sharing_prefs insert own" on public.sharing_prefs
  for insert with check (auth.uid() = user_id);

drop policy if exists "sharing_prefs update own" on public.sharing_prefs;
create policy "sharing_prefs update own" on public.sharing_prefs
  for update using (auth.uid() = user_id);

-- Helper: is auth.uid() paired with target_user, and has target_user shared the given category?
-- security definer so callers don't need privileges on couples/sharing_prefs to evaluate it.
create or replace function public.is_shared_with_me(target_user uuid, category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.couples c
    join public.sharing_prefs s on s.user_id = target_user
    where (
      (c.user_a_id = auth.uid() and c.user_b_id = target_user)
      or (c.user_b_id = auth.uid() and c.user_a_id = target_user)
    )
    and case category
      when 'subscriptions' then s.share_subscriptions
      when 'todos' then s.share_todos
      when 'streaks' then s.share_streaks
      when 'finances' then s.share_finances
      when 'plans' then s.share_plans
      when 'books' then s.share_books
      else false
    end
  );
$$;

grant execute on function public.is_shared_with_me(uuid, text) to authenticated;

-- Widen select policies on existing tables to "own OR partner-shared".
-- Write policies are intentionally left as "own only".

drop policy if exists "subscriptions select own" on public.subscriptions;
drop policy if exists "subscriptions select own or shared" on public.subscriptions;
create policy "subscriptions select own or shared" on public.subscriptions
  for select using (
    auth.uid() = user_id
    or public.is_shared_with_me(user_id, 'subscriptions')
  );

drop policy if exists "todos select own" on public.todos;
drop policy if exists "todos select own or shared" on public.todos;
create policy "todos select own or shared" on public.todos
  for select using (
    auth.uid() = user_id
    or public.is_shared_with_me(user_id, 'todos')
  );

drop policy if exists "streaks select own" on public.streaks;
drop policy if exists "streaks select own or shared" on public.streaks;
create policy "streaks select own or shared" on public.streaks
  for select using (
    auth.uid() = user_id
    or public.is_shared_with_me(user_id, 'streaks')
  );

drop policy if exists "streak_logs select own" on public.streak_logs;
drop policy if exists "streak_logs select own or shared" on public.streak_logs;
create policy "streak_logs select own or shared" on public.streak_logs
  for select using (
    auth.uid() = user_id
    or public.is_shared_with_me(user_id, 'streaks')
  );

drop policy if exists "accounts select own" on public.accounts;
drop policy if exists "accounts select own or shared" on public.accounts;
create policy "accounts select own or shared" on public.accounts
  for select using (
    auth.uid() = user_id
    or public.is_shared_with_me(user_id, 'finances')
  );

drop policy if exists "transactions select own" on public.transactions;
drop policy if exists "transactions select own or shared" on public.transactions;
create policy "transactions select own or shared" on public.transactions
  for select using (
    auth.uid() = user_id
    or public.is_shared_with_me(user_id, 'finances')
  );

drop policy if exists "plans select own" on public.plans;
drop policy if exists "plans select own or shared" on public.plans;
create policy "plans select own or shared" on public.plans
  for select using (
    auth.uid() = user_id
    or public.is_shared_with_me(user_id, 'plans')
  );

-- =============================================================
-- Books (co-authored progress tracking for couples)
-- =============================================================

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid references public.couples(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  target_pages integer check (target_pages is null or target_pages > 0),
  status text not null default 'active' check (status in ('active', 'done', 'paused')),
  started_on date,
  created_at timestamptz not null default now()
);

create index if not exists books_couple_idx on public.books (couple_id);
create index if not exists books_user_idx on public.books (user_id);

alter table public.books enable row level security;

-- Visible to the owner, anyone in the linked couple, or anyone the owner shares books with.
drop policy if exists "books select" on public.books;
create policy "books select" on public.books
  for select using (
    auth.uid() = user_id
    or (
      couple_id is not null
      and exists (
        select 1 from public.couples c
        where c.id = books.couple_id
          and auth.uid() in (c.user_a_id, c.user_b_id)
      )
    )
    or public.is_shared_with_me(user_id, 'books')
  );

drop policy if exists "books insert own" on public.books;
create policy "books insert own" on public.books
  for insert with check (auth.uid() = user_id);

-- Both partners can edit a shared book (e.g. mark it done, raise the target).
drop policy if exists "books update" on public.books;
create policy "books update" on public.books
  for update using (
    auth.uid() = user_id
    or (
      couple_id is not null
      and exists (
        select 1 from public.couples c
        where c.id = books.couple_id
          and auth.uid() in (c.user_a_id, c.user_b_id)
      )
    )
  );

drop policy if exists "books delete own" on public.books;
create policy "books delete own" on public.books
  for delete using (auth.uid() = user_id);

create table if not exists public.book_pages (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null default current_date,
  pages integer not null check (pages >= 0),
  note text,
  created_at timestamptz not null default now(),
  unique (book_id, user_id, log_date)
);

create index if not exists book_pages_book_idx on public.book_pages (book_id);

alter table public.book_pages enable row level security;

drop policy if exists "book_pages select" on public.book_pages;
create policy "book_pages select" on public.book_pages
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.books b
      where b.id = book_pages.book_id
        and (
          b.user_id = auth.uid()
          or (
            b.couple_id is not null
            and exists (
              select 1 from public.couples c
              where c.id = b.couple_id
                and auth.uid() in (c.user_a_id, c.user_b_id)
            )
          )
          or public.is_shared_with_me(b.user_id, 'books')
        )
    )
  );

drop policy if exists "book_pages insert own" on public.book_pages;
create policy "book_pages insert own" on public.book_pages
  for insert with check (auth.uid() = user_id);

drop policy if exists "book_pages update own" on public.book_pages;
create policy "book_pages update own" on public.book_pages
  for update using (auth.uid() = user_id);

drop policy if exists "book_pages delete own" on public.book_pages;
create policy "book_pages delete own" on public.book_pages
  for delete using (auth.uid() = user_id);

-- =============================================================
-- Pulse: daily mood + one-line check-in
-- =============================================================
create table if not exists public.daily_pulse (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null default current_date,
  mood smallint not null check (mood between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, log_date)
);

create index if not exists daily_pulse_user_date_idx
  on public.daily_pulse (user_id, log_date desc);

alter table public.daily_pulse enable row level security;

-- Pulse is intentionally always-shared with the paired partner: the whole
-- point of the feature is to surface how each other is doing today, and
-- gating it behind another toggle would just create one more place to forget.
drop policy if exists "daily_pulse select" on public.daily_pulse;
create policy "daily_pulse select" on public.daily_pulse
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.couples c
      where (c.user_a_id = auth.uid() and c.user_b_id = daily_pulse.user_id)
         or (c.user_b_id = auth.uid() and c.user_a_id = daily_pulse.user_id)
    )
  );

drop policy if exists "daily_pulse insert own" on public.daily_pulse;
create policy "daily_pulse insert own" on public.daily_pulse
  for insert with check (auth.uid() = user_id);

drop policy if exists "daily_pulse update own" on public.daily_pulse;
create policy "daily_pulse update own" on public.daily_pulse
  for update using (auth.uid() = user_id);

drop policy if exists "daily_pulse delete own" on public.daily_pulse;
create policy "daily_pulse delete own" on public.daily_pulse
  for delete using (auth.uid() = user_id);

-- =============================================================
-- Important dates (anniversaries, birthdays, deadlines)
-- =============================================================
create table if not exists public.important_dates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  couple_id uuid references public.couples(id) on delete set null,
  title text not null,
  the_date date not null,
  is_recurring boolean not null default false,
  recurrence_unit text check (recurrence_unit in ('yearly', 'monthly')),
  emoji text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists important_dates_user_idx
  on public.important_dates (user_id);
create index if not exists important_dates_couple_idx
  on public.important_dates (couple_id);

alter table public.important_dates enable row level security;

drop policy if exists "important_dates select" on public.important_dates;
create policy "important_dates select" on public.important_dates
  for select using (
    auth.uid() = user_id
    or (
      couple_id is not null
      and exists (
        select 1 from public.couples c
        where c.id = important_dates.couple_id
          and auth.uid() in (c.user_a_id, c.user_b_id)
      )
    )
  );

drop policy if exists "important_dates insert own" on public.important_dates;
create policy "important_dates insert own" on public.important_dates
  for insert with check (auth.uid() = user_id);

-- Either partner can edit a couple-scoped date (e.g. fix the anniversary).
drop policy if exists "important_dates update" on public.important_dates;
create policy "important_dates update" on public.important_dates
  for update using (
    auth.uid() = user_id
    or (
      couple_id is not null
      and exists (
        select 1 from public.couples c
        where c.id = important_dates.couple_id
          and auth.uid() in (c.user_a_id, c.user_b_id)
      )
    )
  );

drop policy if exists "important_dates delete own" on public.important_dates;
create policy "important_dates delete own" on public.important_dates
  for delete using (auth.uid() = user_id);

-- =============================================================
-- Google OAuth refresh tokens (Phase 0)
-- ----------------------------------------------------------------------------
-- Supabase exposes session.provider_refresh_token only at code-exchange time
-- and then nulls it on the next session refresh. We capture it in
-- /auth/callback, persist here, and refresh access tokens server-side. No
-- client ever reads this table; only service_role bypasses the empty
-- RLS rule set.
-- =============================================================
create table if not exists public.google_oauth (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  refresh_token  text not null,
  access_token   text,
  expires_at     timestamptz,
  scopes         text[] not null default '{}',
  google_sub     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists google_oauth_expires_idx
  on public.google_oauth (expires_at);

alter table public.google_oauth enable row level security;

revoke all on public.google_oauth from anon;
revoke all on public.google_oauth from authenticated;
grant all on public.google_oauth to service_role;

create or replace function public.tg_google_oauth_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists google_oauth_touch on public.google_oauth;
create trigger google_oauth_touch
  before update on public.google_oauth
  for each row execute function public.tg_google_oauth_touch();

-- is_shared_with_me is invoked from RLS policies (under the calling user's
-- role for SELECT-time evaluation). Direct RPC by anon is unnecessary; revoke
-- to keep the surface tight.
revoke execute on function public.is_shared_with_me(uuid, text) from public;
revoke execute on function public.is_shared_with_me(uuid, text) from anon;
