-- The DNESKAi illustration library (owner request, 9 November 2026: every slide carries a photograph). Pexels pictures
-- stored once in a private bucket, with their source, licence, Claude's tags and a use count for least-used selection.
-- Service role only; `docs/dneskai-illustration-library.md`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dneskai-illustrations', 'dneskai-illustrations', false, 15000000, array['image/jpeg'])
on conflict (id) do nothing;

create table public.dneskai_illustrations (
 id uuid primary key default gen_random_uuid(),
 source text not null check (source in ('pexels')),
 source_id text not null unique check (source_id ~ '^pexels:[0-9]{1,20}$'),
 page_url text not null check (page_url ~ '^https://'),
 photographer text not null default '',
 license text not null check (license in ('pexels')),
 topic text not null check (topic ~ '^[a-z]{2,20}$'),
 query text not null,
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 width integer not null check (width > 0),
 height integer not null check (height > 0),
 alt text not null default '',
 tags text[] not null default '{}',
 description text,
 flags jsonb not null default '{}'::jsonb,
 status text not null check (status in ('ready','refused')),
 cost_usd numeric(10,6) not null default 0 check (cost_usd >= 0),
 uses integer not null default 0 check (uses >= 0),
 last_used_at timestamptz,
 created_at timestamptz not null default clock_timestamp()
);
create index dneskai_illustrations_ready on public.dneskai_illustrations (uses, last_used_at) where status = 'ready';
create index dneskai_illustrations_tags on public.dneskai_illustrations using gin (tags) where status = 'ready';
alter table public.dneskai_illustrations enable row level security;
revoke all on public.dneskai_illustrations from public, anon, authenticated;
grant all on public.dneskai_illustrations to service_role;

-- Its own tick, signed like the marketing tick, at the scheduler's base URL; one minute after each marketing tick.
create function marketing_private.dneskai_illustrations_post()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text; v_body jsonb; v_timestamp text;
begin
 select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'marketing_scheduler_url';
 select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'marketing_scheduler_secret';
 if v_url is null or v_secret is null or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/api/marketing/tick$'
  or char_length(v_secret) < 32 or v_secret ~ '\s' then return null; end if;
 v_url := regexp_replace(v_url, '/api/marketing/tick$', '/api/marketing/dneskai/illustrations/tick');
 v_body := jsonb_build_object('tick', gen_random_uuid(), 'kind', 'minute');
 v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
 return net.http_post(url := v_url, body := v_body,
  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret,
   'X-Marketing-Timestamp', v_timestamp, 'X-Marketing-Signature', marketing_private.scheduler_signature(v_secret, v_timestamp, v_body::text)),
  timeout_milliseconds := 58000);
end $$;
revoke all on function marketing_private.dneskai_illustrations_post() from public, anon, authenticated;
select cron.schedule('dneskai-illustrations-tick', '1-59/5 * * * *', 'select marketing_private.dneskai_illustrations_post()');
