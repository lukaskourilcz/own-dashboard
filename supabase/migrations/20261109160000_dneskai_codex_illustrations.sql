-- Codex illustrations share the private library with Pexels photos, with distinct provenance.
alter table public.dneskai_illustrations
  drop constraint dneskai_illustrations_source_check,
  drop constraint dneskai_illustrations_source_id_check,
  drop constraint dneskai_illustrations_license_check,
  add constraint dneskai_illustrations_provenance_check check (
    (source = 'pexels' and license = 'pexels' and source_id ~ '^pexels:[0-9]{1,20}$')
    or (source = 'codex' and license = 'generated' and source_id ~ '^codex:dneskai-ill-[0-9]{3}__[a-z-]+[.]jpg$')
  );

-- Keep the same service-role grants and transaction when linking generated or stock pictures to a brief.
create or replace function public.marketing_dneskai_restyle_add_picture(p_owner uuid, p_brief uuid, p_asset jsonb, p_media jsonb)
returns integer language plpgsql set search_path = '' as $$
declare b public.marketing_dneskai_briefs; a public.marketing_media_assets; v_sha text := p_asset->>'sha256'; v_mime text := p_asset->>'mime'; v_origin text := p_asset->>'originKind'; v_count integer;
begin
 if v_sha !~ '^[a-f0-9]{64}$' or v_mime not in ('image/jpeg','image/png','image/webp') or p_media->>'assetSha256' is distinct from v_sha
  or coalesce(v_origin, '') not in ('stock', 'generated') or p_media->>'originKind' is distinct from v_origin then raise exception 'restyle picture invalid'; end if;
 select * into b from public.marketing_dneskai_briefs where id = p_brief and user_id = p_owner and status <> 'skipped' for update;
 if not found or b.brief is null then raise exception 'restyle brief unavailable'; end if;
 if p_media->>'candidateId' is distinct from b.lead_candidate_id then raise exception 'restyle picture candidate mismatch'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text || 'dneskai-media', 0));
 select * into a from public.marketing_media_assets where user_id = p_owner and sha256 = v_sha for update;
 if not found then
  insert into public.marketing_media_assets(user_id, project_id, sha256, candidate_id, source_id, external_id, origin_url, origin_kind, position, width, height, mime, bytes, storage_path, credit, phash)
  select p_owner, b.project_id, v_sha, b.lead_candidate_id, c.candidate->>'sourceId', c.candidate->>'externalId', p_asset->>'originUrl', v_origin, (p_media->>'position')::int,
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
 values (p_owner, b.project_id, b.lead_candidate_id, a.id, p_asset->>'originUrl', v_origin, (p_media->>'position')::int, p_asset->>'credit') on conflict do nothing;
 if not exists (select 1 from jsonb_array_elements(b.brief->'media') m where m->>'assetSha256' = v_sha) then
  update public.marketing_dneskai_briefs set brief = jsonb_set(brief, '{media}', (brief->'media') || jsonb_build_array(p_media)), updated_at = clock_timestamp() where id = b.id;
 end if;
 select jsonb_array_length(brief->'media') into v_count from public.marketing_dneskai_briefs where id = b.id;
 return v_count;
end $$;
