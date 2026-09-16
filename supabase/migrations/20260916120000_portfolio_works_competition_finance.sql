-- Portfolio scope, project subsections, client Works, Competition research and
-- development-finance allocations.
--
-- * projects.scope separates the product portfolio ("project") from client
--   engagements ("work"); rows that are neither stay "other" but keep working
--   as before. parent_id nests a venture subsection (Design Lab, GoVIRAL)
--   under its repository project. portfolio_key binds a row to the code-level
--   registry in src/lib/portfolio.ts so the eight core projects exist even
--   when the GitHub allow-list does not include their repository.
-- * subscriptions gain the dates a vendor relationship started and ended, the
--   plan name, a vendor URL, free-text notes and a quarterly billing cycle.
-- * subscription_allocations splits one shared subscription (Vercel Pro,
--   Supabase Pro, Claude Max) across projects by share. Unallocated remainder
--   is overhead, never guessed.
-- * transactions.subscription_id ties a paid invoice to the subscription it
--   settled, so the paid amount inherits that subscription's allocation.
-- * competitors stores per-project competitor research: useful features,
--   social content, pricing model, lessons and a 1-5 relevance score.
--
-- Every new table has RLS, explicit authenticated grants, four own-only CRUD
-- policies and foreign-record ownership checks, matching the professional
-- foundation migration. No SECURITY DEFINER function is added.

alter table public.projects
  add column if not exists scope text not null default 'project'
    check (scope in ('project', 'work', 'other')),
  add column if not exists parent_id uuid references public.projects(id) on delete set null,
  add column if not exists portfolio_key text;

create unique index if not exists projects_portfolio_key_idx
  on public.projects (user_id, portfolio_key)
  where portfolio_key is not null;
create index if not exists projects_parent_idx
  on public.projects (user_id, parent_id);

comment on column public.projects.scope is 'project = own product portfolio, work = client engagement, other = synced repository without a dashboard role.';
comment on column public.projects.parent_id is 'Owning project for a venture subsection. Verified by RLS to belong to the same owner.';
comment on column public.projects.portfolio_key is 'Stable key of the code-level portfolio registry entry (src/lib/portfolio.ts).';

drop policy if exists "projects insert own" on public.projects;
create policy "projects insert own" on public.projects
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (parent_id is null or exists (select 1 from public.projects parent where parent.id = parent_id and parent.user_id = (select auth.uid())))
  );

drop policy if exists "projects update own" on public.projects;
create policy "projects update own" on public.projects
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (parent_id is null or (parent_id <> id and exists (select 1 from public.projects parent where parent.id = parent_id and parent.user_id = (select auth.uid()))))
  );

-- Subscriptions: vendor lifecycle and a quarterly cycle (Mobbin bills every
-- three months).
alter table public.subscriptions
  add column if not exists started_on date,
  add column if not exists ended_on date,
  add column if not exists plan text,
  add column if not exists vendor_url text,
  add column if not exists notes text not null default '';

alter table public.subscriptions
  drop constraint if exists subscriptions_billing_cycle_check;
alter table public.subscriptions
  add constraint subscriptions_billing_cycle_check
    check (billing_cycle in ('monthly', 'yearly', 'weekly', 'quarterly'));

comment on column public.subscriptions.started_on is 'First billing date of the vendor relationship, taken from the first invoice.';
comment on column public.subscriptions.ended_on is 'Date the subscription stopped being billed. Null while it is still running.';

-- Shared subscriptions split across projects.
create table if not exists public.subscription_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  share numeric(6, 4) not null check (share > 0 and share <= 1),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, project_id)
);

create index if not exists subscription_allocations_owner_idx
  on public.subscription_allocations (user_id, subscription_id);
create index if not exists subscription_allocations_project_idx
  on public.subscription_allocations (user_id, project_id);

alter table public.subscription_allocations enable row level security;
grant select, insert, update, delete on public.subscription_allocations to authenticated;
grant all on public.subscription_allocations to service_role;

create policy "subscription allocations select own" on public.subscription_allocations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "subscription allocations insert own" on public.subscription_allocations
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid()))
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
create policy "subscription allocations update own" on public.subscription_allocations
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid()))
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
create policy "subscription allocations delete own" on public.subscription_allocations
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Paid invoices settle a subscription; the allocation follows the subscription.
alter table public.transactions
  add column if not exists subscription_id uuid references public.subscriptions(id) on delete set null;
create index if not exists transactions_subscription_idx
  on public.transactions (user_id, subscription_id)
  where subscription_id is not null;

drop policy if exists "transactions insert own" on public.transactions;
create policy "transactions insert own" on public.transactions
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (invoice_id is null or exists (select 1 from public.invoices i where i.id = invoice_id and i.user_id = (select auth.uid())))
    and (subscription_id is null or exists (select 1 from public.subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid())))
  );

drop policy if exists "transactions update own" on public.transactions;
create policy "transactions update own" on public.transactions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (invoice_id is null or exists (select 1 from public.invoices i where i.id = invoice_id and i.user_id = (select auth.uid())))
    and (subscription_id is null or exists (select 1 from public.subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid())))
  );

-- Competition research per project.
create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  url text,
  summary text not null default '',
  category text not null default 'direct'
    check (category in ('direct', 'indirect', 'inspiration')),
  useful_features text[] not null default '{}',
  social_content text not null default '',
  pricing_model text not null default '',
  lessons text not null default '',
  relevance_score smallint check (relevance_score between 1 and 5),
  score_rationale text not null default '',
  social_links text[] not null default '{}',
  source_urls text[] not null default '{}',
  reviewed_at date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists competitors_project_idx
  on public.competitors (user_id, project_id, sort_order);

alter table public.competitors enable row level security;
grant select, insert, update, delete on public.competitors to authenticated;
grant all on public.competitors to service_role;

create policy "competitors select own" on public.competitors
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "competitors insert own" on public.competitors
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
create policy "competitors update own" on public.competitors
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
create policy "competitors delete own" on public.competitors
  for delete to authenticated using ((select auth.uid()) = user_id);

comment on table public.competitors is 'Owner-authored competitor research per project: features, social content, pricing model, lessons and a 1-5 relevance score.';
