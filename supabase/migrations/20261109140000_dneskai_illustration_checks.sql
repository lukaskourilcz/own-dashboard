-- Which DNESKAi post versions have had their photographs checked (owner request, 9 November 2026), so the plan looks
-- at each version once. Service role only.
create table public.dneskai_illustration_checks (
 revision_id uuid primary key references public.marketing_revisions(id) on delete cascade,
 code text not null check (code ~ '^[a-z][a-z0-9-]{1,59}$'),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.dneskai_illustration_checks enable row level security;
revoke all on public.dneskai_illustration_checks from public, anon, authenticated;
grant all on public.dneskai_illustration_checks to service_role;
