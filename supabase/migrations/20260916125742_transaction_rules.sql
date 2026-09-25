-- Staged, specificity-ranked transaction rules.
--
-- `transaction_category_rules` held one keyword and one category per row, was
-- evaluated first-wins on the note alone, and could only write a category. This
-- migration adds `transaction_rules`, which carries a list of conditions
-- (field / operator / value) and a set of actions (category, subscription,
-- project, note), runs in three stages ('pre', 'default', 'post') and is ranked
-- least-specific first inside a stage so a narrow rule overwrites a broad one.
--
-- Conditions and actions are jsonb because their shape is owner-authored and
-- open-ended; the reader in src/lib/transaction-rules.ts parses both
-- defensively and drops malformed entries rather than trusting the column.
--
-- The legacy table is NOT dropped. Its rows are backfilled here as single
-- `note contains …` rules, it stays in the `financial` export scope, and it is
-- the rollback path if the new engine has to be reverted.
--
-- Own-only RLS with explicit authenticated grants and four CRUD policies,
-- matching every other user table. Rule actions carry project/subscription ids
-- but are not foreign keys into those tables: a rule is a template, and the
-- transactions insert/update policies added by
-- 20260916120000_portfolio_works_competition_finance.sql already reject a
-- foreign or stale id at the moment the rule is applied.

create table if not exists public.transaction_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  -- 'pre' runs before the default set, 'post' after it, so a catch-all or an
  -- override can be placed either side of the ranked middle.
  stage text not null default 'default'
    check (stage in ('pre', 'default', 'post')),
  -- [{ "field": "note", "op": "contains", "value": "albert" }, …] — every
  -- condition must hold for the rule to match.
  conditions jsonb not null default '[]'::jsonb,
  -- { "category": "Groceries", "project_id": null, … } — only the keys present
  -- are written to the transaction.
  actions jsonb not null default '{}'::jsonb,
  -- Owner-chosen tiebreak inside a stage once specificity is equal.
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transaction_rules_user_idx
  on public.transaction_rules (user_id, stage, sort_order, created_at);

alter table public.transaction_rules enable row level security;
grant select, insert, update, delete on public.transaction_rules to authenticated;
grant all on public.transaction_rules to service_role;

drop policy if exists "transaction_rules select own" on public.transaction_rules;
create policy "transaction_rules select own" on public.transaction_rules
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "transaction_rules insert own" on public.transaction_rules;
create policy "transaction_rules insert own" on public.transaction_rules
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "transaction_rules update own" on public.transaction_rules;
create policy "transaction_rules update own" on public.transaction_rules
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "transaction_rules delete own" on public.transaction_rules;
create policy "transaction_rules delete own" on public.transaction_rules
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.tg_transaction_rules_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists transaction_rules_touch on public.transaction_rules;
create trigger transaction_rules_touch
  before update on public.transaction_rules
  for each row execute function public.tg_transaction_rules_touch();

comment on table public.transaction_rules is 'Owner-authored transaction rules: staged, specificity-ranked conditions and actions applied on bank sync, CSV import and retroactive apply.';
comment on column public.transaction_rules.conditions is 'jsonb array of { field, op, value }. Parsed defensively by src/lib/transaction-rules.ts; malformed entries are dropped, not trusted.';
comment on column public.transaction_rules.actions is 'jsonb object with optional category, subscription_id, project_id and note. Ids are validated against the owner''s own rows before any update is issued.';

-- Backfill: every legacy keyword rule becomes one `note contains …` rule in the
-- default stage. Guarded by `not exists` so re-running the migration cannot
-- duplicate a rule.
insert into public.transaction_rules (user_id, name, stage, conditions, actions, sort_order)
select
  legacy.user_id,
  legacy.match,
  'default',
  jsonb_build_array(
    jsonb_build_object('field', 'note', 'op', 'contains', 'value', legacy.match)
  ),
  jsonb_build_object('category', legacy.category),
  0
from public.transaction_category_rules as legacy
where not exists (
  select 1
  from public.transaction_rules as existing
  where existing.user_id = legacy.user_id
    and existing.conditions = jsonb_build_array(
      jsonb_build_object('field', 'note', 'op', 'contains', 'value', legacy.match)
    )
    and existing.actions = jsonb_build_object('category', legacy.category)
);

comment on table public.transaction_category_rules is 'Superseded by public.transaction_rules (20260916160000). Retained as the rollback path and kept in the financial export scope; no code path writes it any more.';
