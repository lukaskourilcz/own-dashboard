-- OwnDashboard professional operating-system foundation.
-- Additive first: no legacy personal data is removed by this migration.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'client'
    check (type in ('client', 'prospective_client', 'employer', 'prospective_employer', 'personal_project', 'other')),
  website text,
  logo_url text,
  email text,
  phone text,
  address text,
  city text,
  zip text,
  country text,
  company_id text,
  vat_id text,
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index organizations_user_status_idx
  on public.organizations (user_id, status, name);

alter table public.organizations enable row level security;
grant select, insert, update, delete on public.organizations to authenticated;
grant all on public.organizations to service_role;

create policy "organizations select own" on public.organizations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "organizations insert own" on public.organizations
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "organizations update own" on public.organizations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "organizations delete own" on public.organizations
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.projects
  add column organization_id uuid references public.organizations(id) on delete set null,
  add column summary text not null default '',
  add column status text not null default 'active'
    check (status in ('planned', 'active', 'on_hold', 'completed', 'archived')),
  add column revenue numeric(14, 2) not null default 0,
  add column revenue_currency text not null default 'CZK';

create index projects_organization_idx on public.projects (organization_id);

create table public.client_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  source text not null default 'other'
    check (source in ('tugedr', 'referral', 'direct', 'existing_client', 'inbound', 'other')),
  source_url text,
  title text not null,
  description text not null default '',
  status text not null default 'discovered'
    check (status in ('discovered', 'shortlisted', 'contacted', 'proposal_sent', 'negotiating', 'won', 'lost', 'expired', 'archived')),
  budget_min numeric(14, 2),
  budget_max numeric(14, 2),
  currency text not null default 'CZK',
  rate_type text check (rate_type is null or rate_type in ('fixed', 'hourly', 'daily', 'monthly', 'unknown')),
  deadline date,
  next_follow_up_at timestamptz,
  contact_name text,
  contact_email text,
  notes text not null default '',
  won_at timestamptz,
  lost_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (budget_min is null or budget_min >= 0),
  check (budget_max is null or budget_max >= 0),
  check (budget_min is null or budget_max is null or budget_min <= budget_max)
);

create index client_opportunities_user_status_idx
  on public.client_opportunities (user_id, status, next_follow_up_at);
create index client_opportunities_organization_idx
  on public.client_opportunities (organization_id);
create index client_opportunities_project_idx
  on public.client_opportunities (project_id);

alter table public.client_opportunities enable row level security;
grant select, insert, update, delete on public.client_opportunities to authenticated;
grant all on public.client_opportunities to service_role;

create policy "client_opportunities select own" on public.client_opportunities
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "client_opportunities insert own" on public.client_opportunities
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (organization_id is null or exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.user_id = (select auth.uid())
    ))
    and (project_id is null or exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    ))
  );
create policy "client_opportunities update own" on public.client_opportunities
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (organization_id is null or exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.user_id = (select auth.uid())
    ))
    and (project_id is null or exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    ))
  );
create policy "client_opportunities delete own" on public.client_opportunities
  for delete to authenticated using ((select auth.uid()) = user_id);

create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null default 'quick_add',
  source_id text,
  title text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  suggested_destination text,
  status text not null default 'pending'
    check (status in ('pending', 'snoozed', 'processed', 'dismissed')),
  snoozed_until timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object')
);

create index inbox_items_user_status_idx
  on public.inbox_items (user_id, status, snoozed_until, created_at desc);

alter table public.inbox_items enable row level security;
grant select, insert, update, delete on public.inbox_items to authenticated;
grant all on public.inbox_items to service_role;

create policy "inbox_items select own" on public.inbox_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "inbox_items insert own" on public.inbox_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "inbox_items update own" on public.inbox_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "inbox_items delete own" on public.inbox_items
  for delete to authenticated using ((select auth.uid()) = user_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  source_type text,
  source_id text,
  title text not null,
  body text,
  action_url text,
  read_at timestamptz,
  dismissed_at timestamptz,
  snoozed_until timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null and dismissed_at is null;

alter table public.notifications enable row level security;
grant select, insert, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;
create policy "notifications select own" on public.notifications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "notifications insert own" on public.notifications
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "notifications update own" on public.notifications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "notifications delete own" on public.notifications
  for delete to authenticated using ((select auth.uid()) = user_id);

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  items jsonb not null default '{}'::jsonb,
  summary text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start),
  check (jsonb_typeof(items) = 'object')
);

alter table public.weekly_reviews enable row level security;
grant select, insert, update, delete on public.weekly_reviews to authenticated;
grant all on public.weekly_reviews to service_role;
create policy "weekly_reviews select own" on public.weekly_reviews
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "weekly_reviews insert own" on public.weekly_reviews
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "weekly_reviews update own" on public.weekly_reviews
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "weekly_reviews delete own" on public.weekly_reviews
  for delete to authenticated using ((select auth.uid()) = user_id);

-- The historic repository schema omitted Notes even though production and the
-- application already use it. Make the migration self-contained for a fresh
-- environment without replacing an existing table.
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content jsonb not null default '[]'::jsonb,
  plain_text text not null default '',
  tags text[] not null default '{}',
  is_pinned boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user_updated_idx
  on public.notes (user_id, is_pinned desc, sort_order desc, updated_at desc);
alter table public.notes enable row level security;
grant select, insert, update, delete on public.notes to authenticated;
grant all on public.notes to service_role;
drop policy if exists "notes select own" on public.notes;
drop policy if exists "notes insert own" on public.notes;
drop policy if exists "notes update own" on public.notes;
drop policy if exists "notes delete own" on public.notes;
create policy "notes select own" on public.notes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "notes delete own" on public.notes
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Canonical optional relationships. Existing rows remain valid.
alter table public.todos
  add column project_id uuid references public.projects(id) on delete set null,
  add column organization_id uuid references public.organizations(id) on delete set null,
  add column opportunity_id uuid references public.client_opportunities(id) on delete set null,
  add column job_application_id uuid references public.job_applications(id) on delete set null;
alter table public.notes
  add column project_id uuid references public.projects(id) on delete set null,
  add column organization_id uuid references public.organizations(id) on delete set null,
  add column opportunity_id uuid references public.client_opportunities(id) on delete set null,
  add column job_application_id uuid references public.job_applications(id) on delete set null;
alter table public.invoices
  add column organization_id uuid references public.organizations(id) on delete set null,
  add column project_id uuid references public.projects(id) on delete set null;
alter table public.subscriptions
  add column project_id uuid references public.projects(id) on delete set null;
alter table public.transactions
  add column project_id uuid references public.projects(id) on delete set null,
  add column organization_id uuid references public.organizations(id) on delete set null,
  add column invoice_id uuid references public.invoices(id) on delete set null;
alter table public.important_dates
  add column project_id uuid references public.projects(id) on delete set null,
  add column organization_id uuid references public.organizations(id) on delete set null;
alter table public.prompts
  add column project_id uuid references public.projects(id) on delete set null,
  add column organization_id uuid references public.organizations(id) on delete set null,
  add column opportunity_id uuid references public.client_opportunities(id) on delete set null;
alter table public.job_applications
  add column organization_id uuid references public.organizations(id) on delete set null,
  add column next_follow_up_at timestamptz;
alter table public.user_preferences
  add column ai_enabled boolean not null default true,
  add column ai_sensitive_opt_in boolean not null default false;

create index todos_project_idx on public.todos (user_id, project_id, done);
create index notes_project_idx on public.notes (user_id, project_id, updated_at desc);
create index invoices_project_idx on public.invoices (user_id, project_id, status);
create index subscriptions_project_idx on public.subscriptions (user_id, project_id);
create index transactions_project_idx on public.transactions (user_id, project_id, occurred_on desc);
create index important_dates_project_idx on public.important_dates (user_id, project_id, the_date);
create index job_applications_organization_idx on public.job_applications (user_id, organization_id);

-- Relationship ownership is enforced at the database boundary. These replace
-- the legacy INSERT/UPDATE policies for the affected tables.
drop policy if exists "projects insert own" on public.projects;
drop policy if exists "projects update own" on public.projects;
create policy "projects insert own" on public.projects
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (organization_id is null or exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.user_id = (select auth.uid())
    ))
  );
create policy "projects update own" on public.projects
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (organization_id is null or exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.user_id = (select auth.uid())
    ))
  );

-- Helper predicates are deliberately inlined into policies: there is no
-- SECURITY DEFINER authorization function to expose as an RPC surface.
drop policy if exists "todos insert own" on public.todos;
drop policy if exists "todos update own" on public.todos;
create policy "todos insert own" on public.todos
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (opportunity_id is null or exists (select 1 from public.client_opportunities co where co.id = opportunity_id and co.user_id = (select auth.uid())))
    and (job_application_id is null or exists (select 1 from public.job_applications ja where ja.id = job_application_id and ja.user_id = (select auth.uid())))
  );
create policy "todos update own" on public.todos
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (opportunity_id is null or exists (select 1 from public.client_opportunities co where co.id = opportunity_id and co.user_id = (select auth.uid())))
    and (job_application_id is null or exists (select 1 from public.job_applications ja where ja.id = job_application_id and ja.user_id = (select auth.uid())))
  );

drop policy if exists "invoices insert own" on public.invoices;
drop policy if exists "invoices update own" on public.invoices;
create policy "invoices insert own" on public.invoices
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
  );
create policy "invoices update own" on public.invoices
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
  );

drop policy if exists "subscriptions insert own" on public.subscriptions;
drop policy if exists "subscriptions update own" on public.subscriptions;
create policy "subscriptions insert own" on public.subscriptions
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
  );
create policy "subscriptions update own" on public.subscriptions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
  );

drop policy if exists "transactions insert own" on public.transactions;
drop policy if exists "transactions update own" on public.transactions;
create policy "transactions insert own" on public.transactions
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (invoice_id is null or exists (select 1 from public.invoices i where i.id = invoice_id and i.user_id = (select auth.uid())))
  );
create policy "transactions update own" on public.transactions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (invoice_id is null or exists (select 1 from public.invoices i where i.id = invoice_id and i.user_id = (select auth.uid())))
  );

create policy "notes insert own" on public.notes
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (opportunity_id is null or exists (select 1 from public.client_opportunities co where co.id = opportunity_id and co.user_id = (select auth.uid())))
    and (job_application_id is null or exists (select 1 from public.job_applications ja where ja.id = job_application_id and ja.user_id = (select auth.uid())))
  );
create policy "notes update own" on public.notes
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (opportunity_id is null or exists (select 1 from public.client_opportunities co where co.id = opportunity_id and co.user_id = (select auth.uid())))
    and (job_application_id is null or exists (select 1 from public.job_applications ja where ja.id = job_application_id and ja.user_id = (select auth.uid())))
  );

drop policy if exists "important_dates insert own" on public.important_dates;
drop policy if exists "important_dates update" on public.important_dates;
create policy "important_dates insert own" on public.important_dates
  for insert to authenticated with check (
    (select auth.uid()) = user_id and couple_id is null
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
  );
create policy "important_dates update own" on public.important_dates
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and couple_id is null
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
  );

drop policy if exists "prompts insert own" on public.prompts;
drop policy if exists "prompts update own" on public.prompts;
create policy "prompts insert own" on public.prompts
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (opportunity_id is null or exists (select 1 from public.client_opportunities co where co.id = opportunity_id and co.user_id = (select auth.uid())))
  );
create policy "prompts update own" on public.prompts
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
    and (opportunity_id is null or exists (select 1 from public.client_opportunities co where co.id = opportunity_id and co.user_id = (select auth.uid())))
  );

drop policy if exists "job_applications insert own" on public.job_applications;
drop policy if exists "job_applications update own" on public.job_applications;
create policy "job_applications insert own" on public.job_applications
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
  );
create policy "job_applications update own" on public.job_applications
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.user_id = (select auth.uid())))
  );

drop policy if exists "project_costs insert own" on public.project_costs;
drop policy if exists "project_costs update own" on public.project_costs;
create policy "project_costs insert own" on public.project_costs
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
create policy "project_costs update own" on public.project_costs
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "crons insert own" on public.crons;
drop policy if exists "crons update own" on public.crons;
create policy "crons insert own" on public.crons
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
create policy "crons update own" on public.crons
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "invoice_items insert own" on public.invoice_items;
drop policy if exists "invoice_items update own" on public.invoice_items;
create policy "invoice_items insert own" on public.invoice_items
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.invoices i where i.id = invoice_id and i.user_id = (select auth.uid()))
  );
create policy "invoice_items update own" on public.invoice_items
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.invoices i where i.id = invoice_id and i.user_id = (select auth.uid()))
  );

-- Confirmed opportunity conversion is atomic: organization creation, project
-- creation, and opportunity linkage either all commit or all roll back. The
-- function is SECURITY INVOKER, so the caller's own-only RLS remains active.
create or replace function public.convert_opportunity_to_project(
  p_opportunity_id uuid,
  p_organization_name text default null
)
returns table (
  created_project_id uuid,
  converted_opportunity_id uuid,
  linked_organization_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_opportunity public.client_opportunities%rowtype;
  v_organization_id uuid;
  v_project_id uuid;
  v_slug text;
begin
  select * into v_opportunity
  from public.client_opportunities
  where id = p_opportunity_id and user_id = (select auth.uid())
  for update;

  if not found then raise exception 'Opportunity not found'; end if;
  if v_opportunity.project_id is not null then raise exception 'Opportunity is already converted'; end if;

  v_organization_id := v_opportunity.organization_id;
  if v_organization_id is null then
    if nullif(trim(p_organization_name), '') is null then
      raise exception 'Organization is required';
    end if;
    insert into public.organizations (user_id, name, type)
    values ((select auth.uid()), trim(p_organization_name), 'client')
    returning id into v_organization_id;
  end if;

  v_slug := trim(both '-' from regexp_replace(lower(v_opportunity.title), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then v_slug := 'project'; end if;
  v_slug := left(v_slug, 48) || '-' || left(replace(v_opportunity.id::text, '-', ''), 6);

  insert into public.projects (
    user_id, name, slug, organization_id, summary, notes, status, revenue,
    revenue_currency,
    sort_order, is_active
  ) values (
    (select auth.uid()), v_opportunity.title, v_slug, v_organization_id,
    v_opportunity.description, v_opportunity.notes, 'active',
    coalesce(v_opportunity.budget_max, v_opportunity.budget_min, 0),
    v_opportunity.currency,
    (select count(*)::integer from public.projects where user_id = (select auth.uid())),
    true
  ) returning id into v_project_id;

  update public.client_opportunities
  set project_id = v_project_id,
      organization_id = v_organization_id,
      status = 'won',
      won_at = now(),
      updated_at = now()
  where id = v_opportunity.id;

  return query select v_project_id, v_opportunity.id, v_organization_id;
end;
$$;

revoke all on function public.convert_opportunity_to_project(uuid, text) from public;
revoke all on function public.convert_opportunity_to_project(uuid, text) from anon;
grant execute on function public.convert_opportunity_to_project(uuid, text) to authenticated;
