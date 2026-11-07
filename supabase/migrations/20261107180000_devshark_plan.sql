-- devShark posts (owner request, 7 November 2026): concepts the owner approves one by one, and a publishing plan with
-- one Instagram post a day (12:00 Prague, also on Threads) and a second Threads post (19:00). Nothing is published
-- without the owner's approval of the exact concept; the plan only takes approved concepts. The scheduler fills the
-- plan only with DEVSHARK_PLAN_ENABLED=true.

create table public.marketing_devshark_drafts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 title text not null check(char_length(btrim(title)) between 1 and 160),
 -- The slides as the devShark social renderer draws them (`devshark-deck/1`).
 deck jsonb not null check(jsonb_typeof(deck)='object' and deck->>'schemaVersion'='devshark-deck/1' and jsonb_typeof(deck->'slides')='array'),
 caption text not null check(char_length(caption) between 1 and 2200),
 origin text not null check(origin in ('concept','generated')),
 status text not null default 'draft' check(status in ('draft','approved','rejected','planned','published')),
 decided_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((status='draft' and decided_at is null) or (status in ('approved','rejected') and decided_at is not null) or status in ('planned','published'))
);
create index marketing_devshark_drafts_status on public.marketing_devshark_drafts(user_id,status,decided_at);
alter table public.marketing_devshark_drafts enable row level security;
revoke all on public.marketing_devshark_drafts from public,anon,authenticated;
grant select on public.marketing_devshark_drafts to authenticated;
grant all on public.marketing_devshark_drafts to service_role;
create policy owner_read on public.marketing_devshark_drafts for select to authenticated using ((select auth.uid())=user_id);
create trigger collection_ownership before insert or update on public.marketing_devshark_drafts for each row execute function public.marketing_dneskai_ownership();

create table public.marketing_devshark_plan (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 date date not null,
 local_time text not null check(local_time in ('12:00','19:00')),
 instagram boolean not null,
 threads boolean not null,
 draft_id uuid not null references public.marketing_devshark_drafts(id) on delete cascade,
 status text not null default 'planned' check(status in ('planned','ready','approved','published','skipped','failed')),
 code text check(code is null or code ~ '^[a-z][a-z0-9_-]{0,99}$'),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 -- 12:00 is the day's Instagram post, also on Threads; 19:00 is Threads only.
 check(threads and ((local_time='12:00')=instagram))
);
create unique index marketing_devshark_plan_slot on public.marketing_devshark_plan(user_id,project_id,date,local_time);
create unique index marketing_devshark_plan_draft on public.marketing_devshark_plan(user_id,draft_id);
alter table public.marketing_devshark_plan enable row level security;
revoke all on public.marketing_devshark_plan from public,anon,authenticated;
grant select on public.marketing_devshark_plan to authenticated;
grant all on public.marketing_devshark_plan to service_role;
create policy owner_read on public.marketing_devshark_plan for select to authenticated using ((select auth.uid())=user_id);
create trigger collection_ownership before insert or update on public.marketing_devshark_plan for each row execute function public.marketing_dneskai_ownership();

create function marketing_private.devshark_plan_draft_owner() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.marketing_devshark_drafts d where d.id=new.draft_id and d.user_id=new.user_id and d.project_id=new.project_id) then raise exception 'foreign plan draft'; end if;
 new.updated_at:=clock_timestamp();
 return new;
end $$;
revoke all on function marketing_private.devshark_plan_draft_owner() from public,anon,authenticated;
create trigger plan_draft_owner before insert or update on public.marketing_devshark_plan for each row execute function marketing_private.devshark_plan_draft_owner();

-- The owner's decision on one concept: approve, reject, or take a decision back while it is not planned yet.
create function public.marketing_devshark_decide(p_draft uuid,p_decision text)
returns text language plpgsql security definer set search_path='' as $$
declare d public.marketing_devshark_drafts;
begin
 if p_decision not in ('approved','rejected','draft') then raise exception 'invalid decision'; end if;
 select * into d from public.marketing_devshark_drafts where id=p_draft and user_id=(select auth.uid()) for update;
 if not found then raise exception 'draft unavailable'; end if;
 if d.status not in ('draft','approved','rejected') then raise exception 'draft already planned'; end if;
 update public.marketing_devshark_drafts set status=p_decision,decided_at=case when p_decision='draft' then null else clock_timestamp() end,updated_at=clock_timestamp() where id=d.id;
 return p_decision;
end $$;
revoke all on function public.marketing_devshark_decide(uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_devshark_decide(uuid,text) to authenticated;
