-- DNESKAi Reels (#163): rendered 1080x1920 MP4s, one immutable object per owner and reel key
-- under ownerUUID/marketing/dneskai/reels/<reelKey>.mp4. The trusted render route uploads with
-- upsert:false, verifies size, type, metadata and sha256, then hands Instagram a signed URL.
-- Private like marketing-assets: the Graph API fetches the signed URL, nobody browses the bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('marketing-reels','marketing-reels',false,67108864,array['video/mp4'])
on conflict(id) do update set name=excluded.name,public=false,
 file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy marketing_reels_owner_read on storage.objects
for select to authenticated using (
 bucket_id='marketing-reels' and (storage.foldername(name))[1]=(select auth.uid())::text
);

-- Restrictive policies combine with existing permissive policies. A broad
-- policy for another feature must not grant foreign reads or browser mutation.
create policy marketing_reels_owner_read_guard on storage.objects as restrictive
for select to authenticated using (
 bucket_id<>'marketing-reels' or (storage.foldername(name))[1]=(select auth.uid())::text
);
create policy marketing_reels_anon_read_guard on storage.objects as restrictive
for select to anon using (bucket_id<>'marketing-reels');
create policy marketing_reels_browser_insert_guard on storage.objects as restrictive
for insert to anon,authenticated with check (bucket_id<>'marketing-reels');
create policy marketing_reels_browser_update_guard on storage.objects as restrictive
for update to anon,authenticated using (bucket_id<>'marketing-reels')
with check (bucket_id<>'marketing-reels');
create policy marketing_reels_browser_delete_guard on storage.objects as restrictive
for delete to anon,authenticated using (bucket_id<>'marketing-reels');
