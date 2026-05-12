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
