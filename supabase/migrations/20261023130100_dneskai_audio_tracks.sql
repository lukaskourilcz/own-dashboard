-- DNESKAi audio library (#164): tracks the account may use on Reels, uploaded by the owner in
-- Zdroje -> Hudba. Owner-only reads, service-role writes through /api/marketing/dneskai/audio,
-- which checks the session, the file and the licence fields first. Files live in the private
-- marketing-audio bucket under <owner>/<track id>.<ext>; the Reel renderer reads them with the
-- service role and the Lab plays a short-lived signed URL.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('marketing-audio','marketing-audio',false,20971520,array['audio/mpeg','audio/mp4','audio/aac','audio/x-m4a','audio/wav','audio/x-wav','audio/ogg'])
on conflict(id) do update set name=excluded.name,public=false,
 file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy marketing_audio_owner_read on storage.objects
for select to authenticated using (
 bucket_id='marketing-audio' and (storage.foldername(name))[1]=(select auth.uid())::text
);
create policy marketing_audio_owner_read_guard on storage.objects as restrictive
for select to authenticated using (
 bucket_id<>'marketing-audio' or (storage.foldername(name))[1]=(select auth.uid())::text
);
create policy marketing_audio_anon_read_guard on storage.objects as restrictive
for select to anon using (bucket_id<>'marketing-audio');
-- Uploads come from the browser through a signed upload URL the server issues for one exact path;
-- that path bypasses these policies, so the browser itself still cannot write, replace or delete.
create policy marketing_audio_browser_insert_guard on storage.objects as restrictive
for insert to anon,authenticated with check (bucket_id<>'marketing-audio');
create policy marketing_audio_browser_update_guard on storage.objects as restrictive
for update to anon,authenticated using (bucket_id<>'marketing-audio')
with check (bucket_id<>'marketing-audio');
create policy marketing_audio_browser_delete_guard on storage.objects as restrictive
for delete to anon,authenticated using (bucket_id<>'marketing-audio');

create table public.marketing_audio_tracks (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 120 and title=btrim(title)),
 artist text not null check(length(btrim(artist)) between 1 and 120 and artist=btrim(artist)),
 source text not null check(source in('meta-sound-collection','pixabay','original','instagram-library')),
 licence_note text not null check(length(btrim(licence_note)) between 1 and 500),
 source_url text check(source_url is null or (source_url ~ '^https://' and length(source_url)<=2048)),
 storage_path text,
 instagram_audio_id text check(instagram_audio_id is null or instagram_audio_id ~ '^[0-9]{1,40}$'),
 duration_ms integer not null check(duration_ms between 1000 and 900000),
 mood text[] not null default '{}' check(cardinality(mood)<=5 and array_position(mood,null) is null),
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 -- A file of our own needs a stored file and the page it came from; an Instagram library track needs its id.
 check(case when source='instagram-library' then instagram_audio_id is not null and storage_path is null
  else storage_path is not null and source_url is not null end),
 check(storage_path is null or storage_path ~ ('^marketing-audio/'||user_id::text||'/'||id::text||'\.(mp3|m4a|aac|wav|ogg)$'))
);
create index marketing_audio_tracks_owner_created on public.marketing_audio_tracks(user_id,created_at);

alter table public.marketing_audio_tracks enable row level security;
revoke all on public.marketing_audio_tracks from public,anon,authenticated;
grant select on public.marketing_audio_tracks to authenticated;
grant all on public.marketing_audio_tracks to service_role;
create policy owner_read on public.marketing_audio_tracks for select to authenticated using ((select auth.uid())=user_id);
