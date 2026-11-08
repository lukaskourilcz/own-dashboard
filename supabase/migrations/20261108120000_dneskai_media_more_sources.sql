-- DNESKAi always shows a photo (owner decision, 8 November 2026). Beyond the publisher's own page and feed, a
-- candidate's pictures may now come from the company's official newsroom ('press-kit'), from licensed stock
-- ('stock', Pexels or Unsplash, credit kept here only) and, as the last resort, from an AI illustration
-- ('generated', credit "Ilustrace: AI"). Claude vision scores every linked picture once: a score from 0 to 10,
-- flags for pictures that must not be shown (logo only, screenshot of browser or app chrome, text only) and a
-- focal point the crop uses.

alter table public.marketing_media_assets drop constraint marketing_media_assets_origin_kind_check;
alter table public.marketing_media_assets add constraint marketing_media_assets_origin_kind_check
  check (origin_kind in ('instagram-display','instagram-child','og-image','article-figure','feed-image','press-kit','stock','generated'));
alter table public.marketing_media_asset_links drop constraint marketing_media_asset_links_origin_kind_check;
alter table public.marketing_media_asset_links add constraint marketing_media_asset_links_origin_kind_check
  check (origin_kind in ('instagram-display','instagram-child','og-image','article-figure','feed-image','press-kit','stock','generated'));

-- The plan check names the kinds too; it is rewritten in place so the rest of the function stays exactly as it was.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.marketing_media_set_plan(uuid,uuid,text,uuid,jsonb,text,text)'::regprocedure) into definition;
  if position('''feed-image'')' in definition) = 0 then raise exception 'marketing_media_set_plan kind list not found'; end if;
  execute replace(definition, '''feed-image'')', '''feed-image'',''press-kit'',''stock'',''generated'')');
end $$;

alter table public.marketing_media_asset_links
  add column vision_score smallint check (vision_score between 0 and 10),
  add column vision_flags text[] not null default '{}' check (cardinality(vision_flags) <= 4 and vision_flags <@ array['logo-only','chrome-screenshot','text-only','unrelated']::text[]),
  add column focal_x real check (focal_x between 0 and 1),
  add column focal_y real check (focal_y between 0 and 1),
  add column ranked_at timestamptz;

alter table public.marketing_media_collections
  add column ranked_at timestamptz,
  add column rank_cost_usd numeric(10,6) check (rank_cost_usd >= 0);
create index marketing_media_collections_ranked_idx on public.marketing_media_collections (user_id, ranked_at) where ranked_at is not null;
