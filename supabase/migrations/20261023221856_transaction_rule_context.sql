-- One complete rule/relationship snapshot, without PostgREST's table row cap.
-- Service callers must name their verified connection owner explicitly.
create function public.transaction_rule_context(p_user_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor uuid := coalesce(p_user_id,(select auth.uid())); result jsonb;
begin
  if actor is null or (current_user = 'service_role' and p_user_id is null) or (current_user <> 'service_role' and actor is distinct from (select auth.uid())) then
    raise exception 'Owner required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'owner_id',actor,
    'rules',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from
      (select * from public.transaction_rules where user_id=actor order by id limit 1001) r),'[]'::jsonb),
    'project_ids',coalesce((select jsonb_agg(p.id order by p.id) from
      (select id from public.projects where user_id=actor order by id limit 10001) p),'[]'::jsonb),
    'subscription_ids',coalesce((select jsonb_agg(s.id order by s.id) from
      (select id from public.subscriptions where user_id=actor order by id limit 20001) s),'[]'::jsonb)
  ) into result;
  if jsonb_array_length(result->'rules')>1000 or jsonb_array_length(result->'project_ids')>10000
    or jsonb_array_length(result->'subscription_ids')>20000 or octet_length(result::text)>4194304 then
    raise exception 'Rule context exceeds the complete read bound' using errcode='54000';
  end if;
  return result;
end $$;
revoke all on function public.transaction_rule_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.transaction_rule_context(uuid) to authenticated,service_role;
comment on function public.transaction_rule_context(uuid) is
  'Complete invoker/RLS rule and parent-id snapshot; 1000 rules, 10000 projects, 20000 subscriptions, 4 MiB maximum. No partial result.';
comment on column public.transaction_rules.conditions is
  'jsonb array of {field,op,value}. Application readers refuse the entire rule if any condition is malformed; partial conditions must never broaden a rule.';
