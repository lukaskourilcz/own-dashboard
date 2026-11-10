-- Period consumption and credits are evidence, never recurring monthly commitments or payments.
alter table public.project_costs
  add column cost_type text not null default 'monthly_estimate' check (cost_type in ('monthly_estimate','usage','credit')),
  add column provider text,
  add column period_start timestamptz,
  add column period_end timestamptz,
  add column source_key text,
  add column source_url text,
  add column verified_on date;
alter table public.project_costs add constraint project_cost_evidence_period check (
  (cost_type = 'monthly_estimate' or (period_start is not null and period_end is not null and verified_on is not null and source_key is not null))
  and (period_start is null or period_end is null or period_end > period_start));
create unique index project_costs_evidence_key on public.project_costs(user_id,project_id,source_key) where source_key is not null;
comment on column public.project_costs.cost_type is 'monthly_estimate = recurring budget; usage = accrued period consumption, not paid; credit = prepaid/promotional balance evidence, not an expense.';
