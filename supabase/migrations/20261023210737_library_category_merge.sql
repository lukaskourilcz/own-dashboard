-- The explicit owner action moves links and removes the source category in
-- one transaction. RLS still applies; no privileged connection is used.
create or replace function public.merge_library_category(
  p_source_id uuid, p_target_id uuid, p_source_name text, p_expected_link_ids uuid[]
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_source public.ai_categories;
  v_ids uuid[];
begin
  if v_owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_source_id is null or p_source_id = p_target_id or p_expected_link_ids is null
    or cardinality(p_expected_link_ids) > 10000 then
    raise exception 'Invalid category merge' using errcode = '22023';
  end if;
  -- Lock both categories consistently. This also blocks new references to a
  -- category while it is being removed, rather than silently nulling them.
  perform id from public.ai_categories
    where user_id = v_owner and id in (p_source_id, p_target_id) order by id for update;
  select * into v_source from public.ai_categories where id = p_source_id and user_id = v_owner;
  if not found then raise exception 'Source category not found' using errcode = 'P0002'; end if;
  if v_source.name is distinct from p_source_name then
    raise exception 'Category changed; refresh before merging' using errcode = '40001';
  end if;
  if p_target_id is not null and not exists (
    select 1 from public.ai_categories where id = p_target_id and user_id = v_owner
  ) then raise exception 'Target category not found' using errcode = 'P0002'; end if;
  perform id from public.ai_links where user_id = v_owner and category_id = p_source_id order by id for update;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_ids
    from public.ai_links where user_id = v_owner and category_id = p_source_id;
  if v_ids is distinct from (select coalesce(array_agg(id order by id), '{}'::uuid[]) from unnest(p_expected_link_ids) id) then
    raise exception 'Category resources changed; refresh before merging' using errcode = '40001';
  end if;
  update public.ai_links set category_id = p_target_id, updated_at = now()
    where user_id = v_owner and category_id = p_source_id;
  delete from public.ai_categories where id = p_source_id and user_id = v_owner;
  return jsonb_build_object('source_id', p_source_id, 'target_id', p_target_id, 'moved_ids', to_jsonb(v_ids));
end;
$$;
revoke all on function public.merge_library_category(uuid,uuid,text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.merge_library_category(uuid,uuid,text,uuid[]) to authenticated;
comment on function public.merge_library_category(uuid,uuid,text,uuid[]) is
  'Owner-invoked atomic library category merge. Rejects changed membership; preserves own and related-parent RLS.';
