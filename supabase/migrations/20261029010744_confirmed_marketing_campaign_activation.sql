-- Preserve the authenticated void RPC, confirming its captured status/source
-- identities after every trigger without copying authored source snapshots.
create or replace function public.marketing_activate_campaign(p_campaign uuid, p_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := (select auth.uid());
  selected_brand text;
  captured_ids uuid[];
  expected jsonb;
  persisted jsonb;
begin
  if owner_id is null or p_campaign is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'campaign changed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || 'marketing-campaign', 0));
  select c.brand into selected_brand from public.marketing_campaigns c
    where c.id = p_campaign and c.user_id = owner_id;
  if not found then raise exception 'campaign changed'; end if;

  -- Lock the affected set in one order, before either status update. Existing
  -- archived history stays untouched; an explicitly selected archived plan is
  -- still eligible under the existing source-hash activation contract.
  select array_agg(locked.id order by locked.id),
    jsonb_agg(jsonb_build_array(locked.id, locked.user_id, locked.brand, locked.source_hash,
      case when locked.id = p_campaign then 'active' else 'archived' end) order by locked.id)
    into captured_ids, expected
  from (
    select c.id, c.user_id, c.brand, c.source_hash
    from public.marketing_campaigns c
    where c.user_id = owner_id and c.brand = selected_brand
      and (c.status <> 'archived' or c.id = p_campaign)
    order by c.id for update
  ) locked;
  if captured_ids is null or not (p_campaign = any(captured_ids)) or not exists (
    select 1 from public.marketing_campaigns c where c.id = p_campaign
      and c.user_id = owner_id and c.brand = selected_brand and c.source_hash = p_hash
  ) then raise exception 'campaign changed'; end if;

  -- Archive only the locked set. A subsequently created draft is a new plan,
  -- not part of this captured activation. The existing unique active index
  -- continues to serialize active ownership for this owner and brand.
  update public.marketing_campaigns set status = 'archived'
    where id = any(captured_ids) and id <> p_campaign and status <> 'archived';
  update public.marketing_campaigns set status = 'active'
    where id = p_campaign and user_id = owner_id and brand = selected_brand and source_hash = p_hash;

  select jsonb_agg(jsonb_build_array(c.id, c.user_id, c.brand, c.source_hash, c.status) order by c.id)
    into persisted from public.marketing_campaigns c where c.id = any(captured_ids);
  if persisted is distinct from expected then raise exception 'campaign activation unconfirmed'; end if;
end;
$$;
revoke all on function public.marketing_activate_campaign(uuid,text) from public,anon;
grant execute on function public.marketing_activate_campaign(uuid,text) to authenticated;
