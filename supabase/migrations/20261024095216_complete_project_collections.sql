-- Extend the complete owner snapshot to project metadata and cost/cron inputs.
-- Ordinary SELECT responses can stop at PostgREST max_rows without an error.
-- Complete bounded collections in one statement snapshot and HTTP response.
-- JSON aggregation avoids PostgREST's row cap without raising the project-wide
-- API limit. The entity/order/bound whitelist is server-owned, never caller SQL.
create or replace function public.read_owned_collection(p_entity text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  maximum integer;
  ordering text;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  case p_entity
    when 'projects' then maximum:=20000; ordering:='sort_order,created_at,id';
    when 'project_costs' then maximum:=20000; ordering:='project_id,sort_order,created_at,id';
    when 'crons' then maximum:=20000; ordering:='project_id,created_at,id';
    when 'transactions' then maximum:=20000; ordering:='occurred_on desc,id desc';
    when 'invoices' then maximum:=10000; ordering:='issue_date desc,number desc,id desc';
    when 'invoice_items' then maximum:=50000; ordering:='invoice_id,position,id';
    when 'prompts' then maximum:=10000; ordering:='created_at desc,id desc';
    when 'prompt_links' then maximum:=20000; ordering:='sort_order,created_at,id';
    when 'project_links' then maximum:=20000; ordering:='sort_order,created_at,id';
    when 'ai_links' then maximum:=10000; ordering:='created_at desc,id desc';
    when 'ai_categories' then maximum:=1000; ordering:='sort_order,id';
    when 'repo_notes' then maximum:=10000; ordering:='sort_order,created_at,id';
    when 'repo_links' then maximum:=10000; ordering:='created_at,id';
    when 'todos' then maximum:=20000; ordering:='created_at desc,id desc';
    else raise exception 'Unsupported collection' using errcode='22023';
  end case;
  execute format('select coalesce(jsonb_agg(to_jsonb(owned) order by %s),''[]''::jsonb)
    from (select * from public.%I where user_id=$1 order by %s limit $2) owned',
    ordering,p_entity,ordering) into result using actor,maximum+1;
  if jsonb_array_length(result)>maximum or octet_length(result::text)>10*1024*1024 then
    raise exception 'Collection exceeds the complete read bound' using errcode='54000';
  end if;
  return result;
end;
$$;
revoke all on function public.read_owned_collection(text) from public,anon,service_role;
grant execute on function public.read_owned_collection(text) to authenticated;
comment on function public.read_owned_collection(text) is
  'Whitelisted own-only collections under invoker RLS, one statement snapshot, explicit row and 10 MiB JSON bounds; never returns partial data.';
