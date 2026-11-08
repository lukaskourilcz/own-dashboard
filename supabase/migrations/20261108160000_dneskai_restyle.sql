-- Restyle (owner request, 8 November 2026): the plan regenerates a planned post in the house style and first gives its
-- brief more pictures. This function stores one licensed stock picture the plan downloaded for the brief: the asset
-- row (once per sha256), its link to the brief's lead candidate, and the picture in the brief's media list, all in one
-- transaction. Service role only; the plan step is its one caller.
create function public.marketing_dneskai_restyle_add_picture(p_owner uuid, p_brief uuid, p_asset jsonb, p_media jsonb)
returns integer language plpgsql set search_path = '' as $$
declare b public.marketing_dneskai_briefs; a public.marketing_media_assets; v_sha text := p_asset->>'sha256'; v_mime text := p_asset->>'mime'; v_count integer;
begin
 if v_sha !~ '^[a-f0-9]{64}$' or v_mime not in ('image/jpeg','image/png','image/webp') or p_media->>'assetSha256' is distinct from v_sha
  or p_asset->>'originKind' <> 'stock' or p_media->>'originKind' <> 'stock' then raise exception 'restyle picture invalid'; end if;
 select * into b from public.marketing_dneskai_briefs where id = p_brief and user_id = p_owner and status <> 'skipped' for update;
 if not found or b.brief is null then raise exception 'restyle brief unavailable'; end if;
 if p_media->>'candidateId' is distinct from b.lead_candidate_id then raise exception 'restyle picture candidate mismatch'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text || 'dneskai-media', 0));
 select * into a from public.marketing_media_assets where user_id = p_owner and sha256 = v_sha for update;
 if not found then
  insert into public.marketing_media_assets(user_id, project_id, sha256, candidate_id, source_id, external_id, origin_url, origin_kind, position, width, height, mime, bytes, storage_path, credit, phash)
  select p_owner, b.project_id, v_sha, b.lead_candidate_id, c.candidate->>'sourceId', c.candidate->>'externalId', p_asset->>'originUrl', 'stock', (p_media->>'position')::int,
   (p_asset->>'width')::int, (p_asset->>'height')::int, v_mime, (p_asset->>'bytes')::int,
   'marketing-media/' || p_owner::text || '/' || v_sha || '.' || case v_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end,
   p_asset->>'credit', nullif(p_asset->>'phash', '')
  from public.marketing_dneskai_candidates c where c.user_id = p_owner and c.id = b.lead_candidate_id
  returning * into a;
  if not found then raise exception 'restyle candidate unavailable'; end if;
 elsif a.purged_at is not null then
  update public.marketing_media_assets set purged_at = null where id = a.id returning * into a;
 end if;
 insert into public.marketing_media_asset_links(user_id, project_id, candidate_id, asset_id, origin_url, origin_kind, position, credit)
 values (p_owner, b.project_id, b.lead_candidate_id, a.id, p_asset->>'originUrl', 'stock', (p_media->>'position')::int, p_asset->>'credit') on conflict do nothing;
 if not exists (select 1 from jsonb_array_elements(b.brief->'media') m where m->>'assetSha256' = v_sha) then
  update public.marketing_dneskai_briefs set brief = jsonb_set(brief, '{media}', (brief->'media') || jsonb_build_array(p_media)), updated_at = clock_timestamp() where id = b.id;
 end if;
 select jsonb_array_length(brief->'media') into v_count from public.marketing_dneskai_briefs where id = b.id;
 return v_count;
end $$;
revoke all on function public.marketing_dneskai_restyle_add_picture(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.marketing_dneskai_restyle_add_picture(uuid, uuid, jsonb, jsonb) to service_role;

-- The brief's calendar entry follows the plan slot, so the regeneration job is current for exactly that time.
create function public.marketing_dneskai_restyle_move_entry(p_owner uuid, p_entry uuid, p_date date, p_time text)
returns integer language plpgsql set search_path = '' as $$
declare v integer;
begin
 if p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'restyle time invalid'; end if;
 update public.marketing_calendar_entries set date = p_date, local_time = p_time, status = 'planned', needs_review = false
  where id = p_entry and user_id = p_owner returning generation_version into v;
 if v is null then raise exception 'restyle entry unavailable'; end if;
 return v;
end $$;
revoke all on function public.marketing_dneskai_restyle_move_entry(uuid, uuid, date, text) from public, anon, authenticated;
grant execute on function public.marketing_dneskai_restyle_move_entry(uuid, uuid, date, text) to service_role;
