-- A cost may only be attached to another record owned by the same session.
drop policy if exists "project_costs insert own" on public.project_costs;
create policy "project_costs insert own" on public.project_costs for insert to authenticated
with check (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_costs.project_id and p.user_id = auth.uid()));
drop policy if exists "project_costs update own" on public.project_costs;
create policy "project_costs update own" on public.project_costs for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_costs.project_id and p.user_id = auth.uid()));
