-- The owner's own HeyDarlink ambient pictures (owner decision, 8 November 2026). Lukáš drops `<girl>__<shot_id>.jpg`
-- into the private bucket `heydarlink-ambient-inbox`; the ambient tick gates and ingests each file once and keeps the
-- outcome here. Only the service role reads or writes either; the owner uploads through Supabase Studio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('heydarlink-ambient-inbox', 'heydarlink-ambient-inbox', false, 20000000, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create table public.heydarlink_ambient_imports (
 name text primary key check (char_length(name) between 5 and 200),
 persona text check (persona is null or persona in ('nina','fatimah','teresa','michaela')),
 shot_id text check (shot_id is null or shot_id ~ '^[a-z0-9-]{3,60}$'),
 aspect text check (aspect is null or aspect in ('4:5','9:16')),
 status text not null check (status in ('uploaded','rejected','upload-failed')),
 reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array' and jsonb_array_length(reasons) <= 40),
 cost_usd numeric(10,6) not null default 0 check (cost_usd >= 0),
 phash text check (phash is null or phash ~ '^[0-9a-f]{16}$'),
 sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
 ingest_id text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index heydarlink_ambient_imports_hashes on public.heydarlink_ambient_imports(updated_at desc) where status = 'uploaded';
alter table public.heydarlink_ambient_imports enable row level security;
revoke all on public.heydarlink_ambient_imports from public, anon, authenticated;
grant all on public.heydarlink_ambient_imports to service_role;
