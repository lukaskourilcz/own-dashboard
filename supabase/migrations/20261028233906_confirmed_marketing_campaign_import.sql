-- Confirm complete persisted imports inside the transaction. Replays preserve
-- later owner edits; they never refill deleted slots or rename an existing plan.
create or replace function public.marketing_import_campaign(p_owner uuid, p_campaign jsonb, p_entries jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  campaign_uuid uuid;
  created boolean;
  saved public.marketing_campaigns%rowtype;
  input_count integer;
begin
  if p_owner is null or jsonb_typeof(p_campaign) is distinct from 'object'
    or jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'calendar import input invalid';
  end if;
  input_count := jsonb_array_length(p_entries);
  if input_count > 1000 or octet_length(p_campaign::text) + octet_length(p_entries::text) > 4194304
    or p_campaign->>'brand' is null or p_campaign->>'brand' not in ('dneskai', 'devshark')
    or coalesce(length(p_campaign->>'name'), 0) not between 1 and 10000
    or p_campaign->>'status' is distinct from 'draft'
    or p_campaign->>'time_zone' is distinct from 'Europe/Prague'
    or coalesce(p_campaign->>'source_hash', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_campaign->>'starts_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_campaign->>'ends_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or (p_campaign->>'ends_on')::date <> (p_campaign->>'starts_on')::date + 6
    or jsonb_typeof(p_campaign->'source_snapshot') is distinct from 'object'
    or p_campaign->'source_snapshot'->>'schemaVersion' is distinct from 'marketing-calendar/1'
    or p_campaign->'source_snapshot'->>'project' is distinct from p_campaign->>'brand'
    or exists (
      select 1 from jsonb_array_elements(p_entries) e
      where jsonb_typeof(e) is distinct from 'object'
        or coalesce(length(e->>'source_id'), 0) not between 1 and 300
        or coalesce(length(e->>'title'), 0) not between 1 and 10000
        or coalesce(length(e->>'kind'), 0) not between 1 and 100
        or coalesce(length(e->>'platform'), 0) not between 1 and 100
        or coalesce(e->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
        or (e->>'local_time' is not null and e->>'local_time' !~ '^([01]\d|2[0-3]):[0-5]\d$')
        or e->>'status' is null or e->>'status' not in ('planned', 'blocked', 'backlog', 'published', 'done')
        or jsonb_typeof(e->'needs_review') is distinct from 'boolean'
        or jsonb_typeof(e->'original') is distinct from 'object'
        or jsonb_typeof(e->'knowledge_ids') is distinct from 'array'
    ) or (select count(distinct e->>'source_id') from jsonb_array_elements(p_entries) e) <> input_count then
    raise exception 'calendar import input invalid';
  end if;

  insert into public.marketing_campaigns(user_id, brand, name, starts_on, ends_on, time_zone, source_snapshot, source_hash)
  values (p_owner, p_campaign->>'brand', p_campaign->>'name', (p_campaign->>'starts_on')::date,
    (p_campaign->>'ends_on')::date, p_campaign->>'time_zone', p_campaign->'source_snapshot', p_campaign->>'source_hash')
  on conflict (user_id, brand, source_hash, starts_on) do nothing
  returning id into campaign_uuid;
  created := found;
  if not created then
    select c.id into campaign_uuid from public.marketing_campaigns c
    where c.user_id = p_owner and c.brand = p_campaign->>'brand'
      and c.source_hash = p_campaign->>'source_hash' and c.starts_on = (p_campaign->>'starts_on')::date
    for update;
  end if;
  select * into saved from public.marketing_campaigns where id = campaign_uuid for update;
  if not found or saved.user_id is distinct from p_owner
    or saved.brand is distinct from p_campaign->>'brand'
    or saved.starts_on is distinct from (p_campaign->>'starts_on')::date
    or saved.ends_on is distinct from (p_campaign->>'ends_on')::date
    or saved.time_zone is distinct from p_campaign->>'time_zone'
    or saved.source_snapshot is distinct from p_campaign->'source_snapshot'
    or saved.source_hash is distinct from p_campaign->>'source_hash'
    or (created and (saved.name is distinct from p_campaign->>'name' or saved.status <> 'draft' or saved.project_id is not null)) then
    raise exception 'calendar import campaign unconfirmed';
  end if;

  if created then
    insert into public.marketing_calendar_entries(user_id, campaign_id, source_id, date, local_time, kind, platform, title, original, knowledge_ids, status, needs_review)
    select p_owner, campaign_uuid, e->>'source_id', (e->>'date')::date, e->>'local_time', e->>'kind', e->>'platform',
      e->>'title', e->'original', array(select jsonb_array_elements_text(e->'knowledge_ids'))::uuid[], e->>'status', (e->>'needs_review')::boolean
    from jsonb_array_elements(p_entries) e;
  end if;
  -- Read after all row/statement triggers. RETURNING alone cannot prove this.
  perform 1 from public.marketing_calendar_entries where campaign_id = campaign_uuid order by id for update;
  if (select count(*) from public.marketing_calendar_entries where campaign_id = campaign_uuid) <> input_count
    or exists (
      select 1 from jsonb_array_elements(p_entries) e
      left join public.marketing_calendar_entries row on row.campaign_id = campaign_uuid and row.source_id = e->>'source_id'
      where row.id is null or row.user_id is distinct from p_owner or row.original is distinct from e->'original'
        or (created and (
          row.date is distinct from (e->>'date')::date or row.local_time is distinct from e->>'local_time'
          or row.kind is distinct from e->>'kind' or row.platform is distinct from e->>'platform'
          or row.title is distinct from e->>'title' or row.status is distinct from e->>'status'
          or row.needs_review is distinct from (e->>'needs_review')::boolean
          or row.knowledge_ids is distinct from array(select jsonb_array_elements_text(e->'knowledge_ids'))::uuid[]
          or row.bound_source_id is not null or row.generation_version <> 1
        ))
    ) then
    raise exception 'calendar import entries unconfirmed';
  end if;
  -- An entry trigger may also have altered its parent after the first check.
  if not exists (
    select 1 from public.marketing_campaigns c where c.id = campaign_uuid and c.user_id = p_owner
      and c.brand = saved.brand and c.starts_on = saved.starts_on and c.ends_on = saved.ends_on
      and c.time_zone = saved.time_zone and c.source_hash = saved.source_hash and c.source_snapshot = saved.source_snapshot
      and (not created or (c.name = saved.name and c.status = 'draft' and c.project_id is null))
  ) then raise exception 'calendar import campaign unconfirmed'; end if;
  return campaign_uuid;
end $$;
revoke all on function public.marketing_import_campaign(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.marketing_import_campaign(uuid,jsonb,jsonb) to service_role;
