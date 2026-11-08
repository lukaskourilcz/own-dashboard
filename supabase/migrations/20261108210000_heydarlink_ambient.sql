-- HeyDarlink ambient photos (moved from Quorum, owner decision of 8 November 2026): frames without the girl for the
-- four HeyDarlink Instagram accounts. A batch is one persona's whole shot list, each shot in 4:5 and 9:16; the
-- marketing tick works its frames one at a time (render on fal, grade, gate with Claude, upload to HeyDarlink).
-- A batch has its own cost cap; every frame records what it cost. Service role only: nothing here is shown in the
-- app, and the frames themselves live in HeyDarlink, not here.
create table public.heydarlink_ambient_batches (
 id uuid primary key default gen_random_uuid(),
 persona text not null check (persona in ('nina','fatimah','teresa','michaela')),
 status text not null default 'open' check (status in ('open','done','capped')),
 reason text not null check (reason in ('manual','low-stock')),
 cap_usd numeric(8,4) not null check (cap_usd > 0 and cap_usd <= 20),
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz
);
-- One open batch per persona: a second request while one runs is a repeat, not a new batch.
create unique index heydarlink_ambient_batches_open on public.heydarlink_ambient_batches(persona) where status = 'open';

create table public.heydarlink_ambient_frames (
 id uuid primary key default gen_random_uuid(),
 batch_id uuid not null references public.heydarlink_ambient_batches(id) on delete cascade,
 persona text not null check (persona in ('nina','fatimah','teresa','michaela')),
 shot_id text not null check (shot_id ~ '^[a-z0-9-]{3,60}$'),
 pillar text not null,
 aspect text not null check (aspect in ('4:5','9:16')),
 prompt text not null check (char_length(prompt) between 40 and 900),
 status text not null default 'pending' check (status in ('pending','running','uploaded','rejected','duplicate-on-server','upload-failed','skipped-cap')),
 attempts smallint not null default 0 check (attempts between 0 and 4),
 reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array' and jsonb_array_length(reasons) <= 40),
 provider text,
 model text,
 cost_usd numeric(10,6) not null default 0 check (cost_usd >= 0),
 phash text check (phash is null or phash ~ '^[0-9a-f]{16}$'),
 sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
 seed bigint,
 source_ref text,
 ingest_id text,
 lease_until timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique (batch_id, shot_id, aspect)
);
create index heydarlink_ambient_frames_work on public.heydarlink_ambient_frames(status, created_at) where status in ('pending','running');
create index heydarlink_ambient_frames_hashes on public.heydarlink_ambient_frames(updated_at desc) where status = 'uploaded';

alter table public.heydarlink_ambient_batches enable row level security;
alter table public.heydarlink_ambient_frames enable row level security;
revoke all on public.heydarlink_ambient_batches from public, anon, authenticated;
revoke all on public.heydarlink_ambient_frames from public, anon, authenticated;
grant all on public.heydarlink_ambient_batches to service_role;
grant all on public.heydarlink_ambient_frames to service_role;

-- Claims the next frame to work, so two ticks never render the same frame. A frame whose lease ran out is free again.
create function public.heydarlink_ambient_claim(p_lease_seconds integer)
returns setof public.heydarlink_ambient_frames language sql set search_path = '' as $$
 update public.heydarlink_ambient_frames f set status = 'running', lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds), updated_at = clock_timestamp()
 where f.id = (
  select g.id from public.heydarlink_ambient_frames g join public.heydarlink_ambient_batches b on b.id = g.batch_id
  where b.status = 'open' and (g.status = 'pending' or (g.status = 'running' and g.lease_until < clock_timestamp()))
  order by g.created_at, g.shot_id, g.aspect limit 1 for update of g skip locked)
 returning f.*;
$$;
revoke all on function public.heydarlink_ambient_claim(integer) from public, anon, authenticated;
grant execute on function public.heydarlink_ambient_claim(integer) to service_role;
