-- Aggregate the whole owned cohort independently of the bounded UI list.
create function public.freelance_opportunity_metrics(p_platform_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'saved', count(*),
    'submitted', count(*) filter (where submitted_on <= current_date),
    'replies', count(*) filter (where submitted_on <= current_date and responded_on between submitted_on and current_date),
    'won', count(*) filter (where submitted_on <= current_date and status = 'won'),
    'responseRate', round(100.0 * count(*) filter (where submitted_on <= current_date and responded_on between submitted_on and current_date)
      / nullif(count(*) filter (where submitted_on <= current_date), 0))
  ) from public.client_opportunities
  where user_id = (select auth.uid()) and (p_platform_id is null or platform_id = p_platform_id);
$$;
revoke all on function public.freelance_opportunity_metrics(uuid) from public, anon;
grant execute on function public.freelance_opportunity_metrics(uuid) to authenticated;
