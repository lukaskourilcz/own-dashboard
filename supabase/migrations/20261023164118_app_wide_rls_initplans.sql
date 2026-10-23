-- Evaluate the session identity once per statement, preserving every existing
-- role, command, ownership predicate and foreign-record ownership check.
-- Catalog review: 73 simple policies still called auth.uid() per row.

alter policy "accounts delete own" on public.accounts
  using (((select auth.uid()) = user_id));

alter policy "accounts insert own" on public.accounts
  with check (((select auth.uid()) = user_id));

alter policy "accounts update own" on public.accounts
  using (((select auth.uid()) = user_id));

alter policy "ai_categories delete own" on public.ai_categories
  using (((select auth.uid()) = user_id));

alter policy "ai_categories insert own" on public.ai_categories
  with check (((select auth.uid()) = user_id));

alter policy "ai_categories select own" on public.ai_categories
  using (((select auth.uid()) = user_id));

alter policy "ai_categories update own" on public.ai_categories
  using (((select auth.uid()) = user_id));

alter policy "ai_links delete own" on public.ai_links
  using (((select auth.uid()) = user_id));

alter policy "ai_links select own" on public.ai_links
  using (((select auth.uid()) = user_id));

alter policy "bank_connections delete own" on public.bank_connections
  using (((select auth.uid()) = user_id));

alter policy "bank_connections select own" on public.bank_connections
  using (((select auth.uid()) = user_id));

alter policy "cover_letter_templates delete own" on public.cover_letter_templates
  using (((select auth.uid()) = user_id));

alter policy "cover_letter_templates insert own" on public.cover_letter_templates
  with check (((select auth.uid()) = user_id));

alter policy "cover_letter_templates select own" on public.cover_letter_templates
  using (((select auth.uid()) = user_id));

alter policy "cover_letter_templates update own" on public.cover_letter_templates
  using (((select auth.uid()) = user_id));

alter policy "crons delete own" on public.crons
  using (((select auth.uid()) = user_id));

alter policy "crons select own" on public.crons
  using (((select auth.uid()) = user_id));

alter policy "important_dates delete own" on public.important_dates
  using (((select auth.uid()) = user_id));

alter policy "invoice_items delete own" on public.invoice_items
  using (((select auth.uid()) = user_id));

alter policy "invoice_items select own" on public.invoice_items
  using (((select auth.uid()) = user_id));

alter policy "invoice_settings insert own" on public.invoice_settings
  with check (((select auth.uid()) = user_id));

alter policy "invoice_settings select own" on public.invoice_settings
  using (((select auth.uid()) = user_id));

alter policy "invoice_settings update own" on public.invoice_settings
  using (((select auth.uid()) = user_id));

alter policy "invoices delete own" on public.invoices
  using (((select auth.uid()) = user_id));

alter policy "invoices select own" on public.invoices
  using (((select auth.uid()) = user_id));

alter policy "job_application_events delete own" on public.job_application_events
  using (((select auth.uid()) = user_id));

alter policy "job_application_events insert own" on public.job_application_events
  with check (((select auth.uid()) = user_id));

alter policy "job_application_events select own" on public.job_application_events
  using (((select auth.uid()) = user_id));

alter policy "job_applications delete own" on public.job_applications
  using (((select auth.uid()) = user_id));

alter policy "job_applications select own" on public.job_applications
  using (((select auth.uid()) = user_id));

alter policy "job_user_state delete own" on public.job_user_state
  using (((select auth.uid()) = user_id));

alter policy "job_user_state insert own" on public.job_user_state
  with check (((select auth.uid()) = user_id));

alter policy "job_user_state select own" on public.job_user_state
  using (((select auth.uid()) = user_id));

alter policy "job_user_state update own" on public.job_user_state
  using (((select auth.uid()) = user_id));

alter policy "notification_log select own" on public.notification_log
  using (((select auth.uid()) = user_id));

alter policy "plans delete own" on public.plans
  using (((select auth.uid()) = user_id));

alter policy "plans insert own" on public.plans
  with check (((select auth.uid()) = user_id));

alter policy "plans update own" on public.plans
  using (((select auth.uid()) = user_id));

alter policy "profiles insert own" on public.profiles
  with check (((select auth.uid()) = id));

alter policy "profiles update own" on public.profiles
  using (((select auth.uid()) = id));

alter policy "project_costs delete own" on public.project_costs
  using (((select auth.uid()) = user_id));

alter policy "project_costs select own" on public.project_costs
  using (((select auth.uid()) = user_id));

alter policy "projects delete own" on public.projects
  using (((select auth.uid()) = user_id));

alter policy "projects select own" on public.projects
  using (((select auth.uid()) = user_id));

alter policy "prompts delete own" on public.prompts
  using (((select auth.uid()) = user_id));

alter policy "prompts select own" on public.prompts
  using (((select auth.uid()) = user_id));

alter policy "reference_rows delete own" on public.reference_rows
  using (((select auth.uid()) = user_id));

alter policy "reference_rows insert own" on public.reference_rows
  with check (((select auth.uid()) = user_id));

alter policy "reference_rows select own" on public.reference_rows
  using (((select auth.uid()) = user_id));

alter policy "reference_rows update own" on public.reference_rows
  using (((select auth.uid()) = user_id));

alter policy "repo_links delete own" on public.repo_links
  using (((select auth.uid()) = user_id));

alter policy "repo_links insert own" on public.repo_links
  with check (((select auth.uid()) = user_id));

alter policy "repo_links select own" on public.repo_links
  using (((select auth.uid()) = user_id));

alter policy "repo_links update own" on public.repo_links
  using (((select auth.uid()) = user_id));

alter policy "repo_notes delete own" on public.repo_notes
  using (((select auth.uid()) = user_id));

alter policy "repo_notes insert own" on public.repo_notes
  with check (((select auth.uid()) = user_id));

alter policy "repo_notes select own" on public.repo_notes
  using (((select auth.uid()) = user_id));

alter policy "repo_notes update own" on public.repo_notes
  using (((select auth.uid()) = user_id));

alter policy "shortcuts delete own" on public.shortcuts
  using (((select auth.uid()) = user_id));

alter policy "shortcuts insert own" on public.shortcuts
  with check (((select auth.uid()) = user_id));

alter policy "shortcuts select own" on public.shortcuts
  using (((select auth.uid()) = user_id));

alter policy "shortcuts update own" on public.shortcuts
  using (((select auth.uid()) = user_id));

alter policy "spend_categories delete own" on public.spend_categories
  using (((select auth.uid()) = user_id));

alter policy "spend_categories insert own" on public.spend_categories
  with check (((select auth.uid()) = user_id));

alter policy "spend_categories select own" on public.spend_categories
  using (((select auth.uid()) = user_id));

alter policy "spend_categories update own" on public.spend_categories
  using (((select auth.uid()) = user_id));

alter policy "subscriptions delete own" on public.subscriptions
  using (((select auth.uid()) = user_id));

alter policy "todos delete own" on public.todos
  using (((select auth.uid()) = user_id));

alter policy "tx_category_rules delete own" on public.transaction_category_rules
  using (((select auth.uid()) = user_id));

alter policy "tx_category_rules insert own" on public.transaction_category_rules
  with check (((select auth.uid()) = user_id));

alter policy "tx_category_rules select own" on public.transaction_category_rules
  using (((select auth.uid()) = user_id));

alter policy "tx_category_rules update own" on public.transaction_category_rules
  using (((select auth.uid()) = user_id));

alter policy "transactions delete own" on public.transactions
  using (((select auth.uid()) = user_id));
