-- Backlog notes and hand-over to agents (owner request, 8 November 2026). The owner writes an answer or input in
-- `note` (multi-line) and can move the item to `ready_for_agent` in the same action; an agent session picks those
-- up (README, "Backlog for agents"). `note_updated_at` is the time of the last note edit, set by the owner trigger.
--
-- The contract columns of 20261108200000 stay as they were; the agents' insert of project, title, description,
-- source and external_ref keeps working.

alter table public.backlog_items
 add column note text check (note is null or char_length(note) <= 20000),
 add column note_updated_at timestamptz;

alter table public.backlog_items drop constraint backlog_items_status_check;
alter table public.backlog_items add constraint backlog_items_status_check
 check (status in ('open','ready_for_agent','in_progress','done','dropped'));

create index backlog_items_ready on public.backlog_items(created_at) where status='ready_for_agent';

create or replace function public.backlog_items_owner() returns trigger language plpgsql security definer set search_path='' as $$
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
 if (tg_op='INSERT' and new.note is not null) or (tg_op='UPDATE' and new.note is distinct from old.note) then new.note_updated_at:=now();
 elsif tg_op='UPDATE' then new.note_updated_at:=old.note_updated_at;
 end if;
 new.updated_at:=now();
 return new;
end $$;
revoke all on function public.backlog_items_owner() from public,anon,authenticated;
