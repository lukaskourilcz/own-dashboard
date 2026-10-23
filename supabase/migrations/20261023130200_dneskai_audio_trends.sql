-- DNESKAi trending audio (#167): the day's trending sounds Meta's Audio API returns for @dneskai under Facebook
-- Login (GET /ig_audio without a search query), one row per owner and Instagram audio id. The daily tick writes it
-- with the service role; the owner reads it in Zdroje -> Hudba and the Lab picker. Nothing here is a secret; the
-- preview link Meta returns expires after about 1.5 days and is not stored.
create table public.marketing_audio_trends (
 user_id uuid not null references auth.users(id) on delete cascade,
 audio_id text not null check(audio_id ~ '^[0-9]{1,40}$'),
 title text not null check(length(title) between 1 and 300),
 display_artist text check(display_artist is null or length(display_artist)<=300),
 audio_type text not null check(audio_type in('music','original_sound')),
 duration_ms integer check(duration_ms is null or duration_ms between 0 and 3600000),
 cover_artwork_thumbnail_url text check(cover_artwork_thumbnail_url is null or (cover_artwork_thumbnail_url ~ '^https://' and length(cover_artwork_thumbnail_url)<=2048)),
 first_seen date not null,
 last_seen date not null,
 days_seen integer not null default 1 check(days_seen>=1),
 -- Filled by the niche ranking and the TikTok signal when they exist; 0 and false until then.
 niche_count integer not null default 0 check(niche_count>=0),
 tiktok boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key(user_id,audio_id),
 check(last_seen>=first_seen)
);
create index marketing_audio_trends_owner_seen on public.marketing_audio_trends(user_id,last_seen desc);

alter table public.marketing_audio_trends enable row level security;
revoke all on public.marketing_audio_trends from public,anon,authenticated;
grant select on public.marketing_audio_trends to authenticated;
grant all on public.marketing_audio_trends to service_role;
create policy owner_read on public.marketing_audio_trends for select to authenticated using ((select auth.uid())=user_id);
