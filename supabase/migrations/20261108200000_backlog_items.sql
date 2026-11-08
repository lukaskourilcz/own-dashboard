-- The shared backlog (owner request, 8 November 2026): every agent on the owner's laptop adds a task here when the
-- owner says "přidej to do backlogu". The columns project…updated_at are a fixed contract that the global agent
-- instructions rely on: an insert of only project, title, description, source and external_ref, run as postgres
-- through the Supabase MCP, must work.
--
-- user_id is the own-only RLS column every owner table has. An insert without it (the agents run as postgres, so
-- auth.uid() is null) gets the signed-in user, or else the dashboard's single owner; with more than one account the
-- insert must name the owner.

create table public.backlog_items (
 id uuid primary key default gen_random_uuid(),
 project text not null check (project in ('heyDarlink','DNESKAi','devShark','personal')),
 title text not null,
 description text,
 status text not null default 'open' check (status in ('open','in_progress','done','dropped')),
 source text,
 external_ref text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 user_id uuid not null references auth.users(id) on delete cascade
);
create index backlog_items_project_status_created on public.backlog_items(project,status,created_at);
create index backlog_items_owner on public.backlog_items(user_id,created_at);

create function public.backlog_items_owner() returns trigger language plpgsql security definer set search_path='' as $$
declare only_owner uuid;
begin
 if tg_op='INSERT' and new.user_id is null then
  new.user_id:=auth.uid();
  if new.user_id is null then
   if (select count(*) from auth.users)<>1 then raise exception 'backlog owner required'; end if;
   select id into only_owner from auth.users;
   new.user_id:=only_owner;
  end if;
 end if;
 if tg_op='UPDATE' then new.user_id:=old.user_id; new.created_at:=old.created_at; end if;
 new.updated_at:=now();
 return new;
end $$;
revoke all on function public.backlog_items_owner() from public,anon,authenticated;
create trigger backlog_items_owner before insert or update on public.backlog_items for each row execute function public.backlog_items_owner();

alter table public.backlog_items enable row level security;
revoke all on public.backlog_items from public,anon,authenticated;
grant select,insert,update,delete on public.backlog_items to authenticated;
grant all on public.backlog_items to service_role;
create policy "backlog_items select own" on public.backlog_items for select to authenticated using ((select auth.uid())=user_id);
create policy "backlog_items insert own" on public.backlog_items for insert to authenticated with check ((select auth.uid())=user_id);
create policy "backlog_items update own" on public.backlog_items for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "backlog_items delete own" on public.backlog_items for delete to authenticated using ((select auth.uid())=user_id);
