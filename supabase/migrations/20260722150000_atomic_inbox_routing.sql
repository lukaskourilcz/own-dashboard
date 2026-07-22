-- Route one owned Inbox item and mark it processed in one transaction.
-- SECURITY INVOKER keeps every destination insert/update subject to existing
-- own-only RLS and related-entity ownership checks.

create or replace function public.route_inbox_item(
  p_inbox_item_id uuid,
  p_destination text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_item public.inbox_items%rowtype;
  v_destination_id uuid;
  v_project_id uuid;
  v_organization_id uuid;
  v_opportunity_id uuid;
  v_job_application_id uuid;
  v_transaction_id uuid;
  v_category text;
  v_date date;
  v_company text;
  v_slug text;
  v_uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_destination not in (
    'task', 'note', 'opportunity', 'project', 'organization',
    'job_application', 'important_date', 'transaction_category'
  ) then
    raise exception 'invalid destination' using errcode = '22023';
  end if;

  select * into v_item
  from public.inbox_items
  where id = p_inbox_item_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'inbox item not found' using errcode = 'P0002';
  end if;

  -- A repeated request returns the original result instead of duplicating it.
  if v_item.status = 'processed' then
    return jsonb_build_object(
      'inbox_item', to_jsonb(v_item),
      'destination', v_item.payload ->> 'routed_destination',
      'destination_id', v_item.payload ->> 'routed_record_id',
      'already_processed', true
    );
  end if;

  v_project_id := case when coalesce(v_item.payload ->> 'project_id', '') ~ v_uuid_pattern then (v_item.payload ->> 'project_id')::uuid end;
  v_organization_id := case when coalesce(v_item.payload ->> 'organization_id', '') ~ v_uuid_pattern then (v_item.payload ->> 'organization_id')::uuid end;
  v_opportunity_id := case when coalesce(v_item.payload ->> 'opportunity_id', '') ~ v_uuid_pattern then (v_item.payload ->> 'opportunity_id')::uuid end;
  v_job_application_id := case when coalesce(v_item.payload ->> 'job_application_id', '') ~ v_uuid_pattern then (v_item.payload ->> 'job_application_id')::uuid end;

  case p_destination
    when 'task' then
      insert into public.todos (user_id, title, source, project_id, organization_id, opportunity_id, job_application_id)
      values (v_user_id, v_item.title, 'manual', v_project_id, v_organization_id, v_opportunity_id, v_job_application_id)
      returning id into v_destination_id;
    when 'note' then
      insert into public.notes (user_id, title, content, plain_text, tags, project_id, organization_id, opportunity_id, job_application_id)
      values (v_user_id, v_item.title, '[]'::jsonb, coalesce(v_item.summary, v_item.title), array['inbox'], v_project_id, v_organization_id, v_opportunity_id, v_job_application_id)
      returning id into v_destination_id;
    when 'opportunity' then
      insert into public.client_opportunities (user_id, title, description, source, project_id, organization_id)
      values (v_user_id, v_item.title, coalesce(v_item.summary, ''), 'other', v_project_id, v_organization_id)
      returning id into v_destination_id;
    when 'project' then
      v_slug := trim(both '-' from lower(regexp_replace(v_item.title, '[^a-zA-Z0-9]+', '-', 'g')));
      if v_slug = '' then v_slug := 'project'; end if;
      v_slug := left(v_slug, 48) || '-' || left(v_item.id::text, 6);
      insert into public.projects (user_id, name, slug, summary, sort_order)
      values (v_user_id, v_item.title, v_slug, coalesce(v_item.summary, ''), 0)
      returning id into v_destination_id;
    when 'organization' then
      insert into public.organizations (user_id, name, type, notes)
      values (v_user_id, v_item.title, 'prospective_client', coalesce(v_item.summary, ''))
      returning id into v_destination_id;
    when 'job_application' then
      v_company := nullif(trim(v_item.payload ->> 'company'), '');
      insert into public.job_applications (user_id, title, company, notes, organization_id)
      values (v_user_id, v_item.title, v_company, v_item.summary, v_organization_id)
      returning id into v_destination_id;
    when 'important_date' then
      v_date := case when coalesce(v_item.payload ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_item.payload ->> 'date')::date else current_date end;
      insert into public.important_dates (user_id, title, the_date, notes, is_recurring, project_id, organization_id)
      values (v_user_id, v_item.title, v_date, v_item.summary, false, v_project_id, v_organization_id)
      returning id into v_destination_id;
    when 'transaction_category' then
      v_transaction_id := case when coalesce(v_item.source_id, '') ~ v_uuid_pattern then v_item.source_id::uuid end;
      v_category := nullif(trim(v_item.payload ->> 'category'), '');
      if v_item.source_type <> 'transaction' or v_transaction_id is null or v_category is null then
        raise exception 'invalid transaction category destination' using errcode = '22023';
      end if;
      update public.transactions
      set category = v_category
      where id = v_transaction_id and user_id = v_user_id
      returning id into v_destination_id;
      if v_destination_id is null then
        raise exception 'transaction not found' using errcode = 'P0002';
      end if;
  end case;

  update public.inbox_items
  set status = 'processed',
      processed_at = now(),
      snoozed_until = null,
      suggested_destination = p_destination,
      payload = payload || jsonb_build_object(
        'routed_destination', p_destination,
        'routed_record_id', v_destination_id::text
      ),
      updated_at = now()
  where id = v_item.id and user_id = v_user_id
  returning * into v_item;

  return jsonb_build_object(
    'inbox_item', to_jsonb(v_item),
    'destination', p_destination,
    'destination_id', v_destination_id,
    'already_processed', false
  );
end;
$$;

revoke all on function public.route_inbox_item(uuid, text) from public, anon;
grant execute on function public.route_inbox_item(uuid, text) to authenticated, service_role;

comment on function public.route_inbox_item(uuid, text) is
  'Atomically routes one owned Inbox item through existing own-only RLS policies and marks it processed.';
