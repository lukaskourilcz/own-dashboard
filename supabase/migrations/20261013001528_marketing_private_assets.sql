-- Private immutable marketing JPEGs. The trusted worker uploads with upsert:false
-- under ownerUUID/marketing/brand/revisionUUID/templateSHA/slide-contentSHA.jpg.
-- It verifies bytes/size/MIME plus ownerId, sha256, revisionId, templateSha256,
-- designExportSha256, svgSha256 and rendererVersion before issuing a signed URL.
-- RLS protects browser access; service-role bypass is deliberately server-only.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('marketing-assets','marketing-assets',false,8388608,array['image/jpeg'])
on conflict(id) do update set name=excluded.name,public=false,
 file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy marketing_assets_owner_read on storage.objects
for select to authenticated using (
 bucket_id='marketing-assets' and (storage.foldername(name))[1]=(select auth.uid())::text
);

-- Restrictive policies combine with existing permissive policies. A broad
-- policy for another feature must not grant foreign reads or browser mutation.
create policy marketing_assets_owner_read_guard on storage.objects as restrictive
for select to authenticated using (
 bucket_id<>'marketing-assets' or (storage.foldername(name))[1]=(select auth.uid())::text
);
create policy marketing_assets_anon_read_guard on storage.objects as restrictive
for select to anon using (bucket_id<>'marketing-assets');
create policy marketing_assets_browser_insert_guard on storage.objects as restrictive
for insert to anon,authenticated with check (bucket_id<>'marketing-assets');
create policy marketing_assets_browser_update_guard on storage.objects as restrictive
for update to anon,authenticated using (bucket_id<>'marketing-assets')
with check (bucket_id<>'marketing-assets');
create policy marketing_assets_browser_delete_guard on storage.objects as restrictive
for delete to anon,authenticated using (bucket_id<>'marketing-assets');
