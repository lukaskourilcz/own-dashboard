-- The DNESKAi publishing plan (owner decision, 7 November 2026): a rolling 30-day calendar of slots. Instagram posts
-- three times a day (08:00, 12:30, 17:00 Prague) and Threads repeats those three and adds its own 20:00 post. A slot
-- holds one news revision the owner approved into the plan, or one approved education topic.
--
-- The scheduler's plan step (src/lib/marketing/dneskai-plan.ts) works only on slots inside its horizon: it renders the
-- post in Spotlight, moves it to the slot's time, approves the exact rendered version for the owner and derives the
-- Threads twin. The owner can still open the post in the Design Lab and change it; the step follows the newest
-- revision of the post (`revision_id` is the first one, `head_revision_id` the one going out).

create table public.marketing_dneskai_plan (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 date date not null,
 local_time text not null check(local_time in ('08:00','12:30','17:00','20:00')),
 instagram boolean not null,
 threads boolean not null,
 kind text not null check(kind in ('news','education')),
 revision_id uuid references public.marketing_revisions(id) on delete set null,
 topic_id uuid references public.marketing_dneskai_topics(id) on delete set null,
 head_revision_id uuid references public.marketing_revisions(id) on delete set null,
 threads_revision_id uuid references public.marketing_revisions(id) on delete set null,
 status text not null default 'planned' check(status in ('planned','generating','ready','approved','published','skipped','failed')),
 code text check(code is null or code ~ '^[a-z][a-z0-9_-]{0,99}$'),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check(instagram or threads),
 -- The 20:00 slot is Threads only; the other three post on Instagram.
 check((local_time='20:00')=(not instagram)),
 check(revision_id is not null or topic_id is not null)
);
-- One post per time; a post sits in one slot.
create unique index marketing_dneskai_plan_slot on public.marketing_dneskai_plan(user_id,project_id,date,local_time);
create unique index marketing_dneskai_plan_revision on public.marketing_dneskai_plan(user_id,revision_id) where revision_id is not null;
create unique index marketing_dneskai_plan_topic on public.marketing_dneskai_plan(user_id,topic_id) where topic_id is not null;
create index marketing_dneskai_plan_threads_revision on public.marketing_dneskai_plan(threads_revision_id) where threads_revision_id is not null;
create index marketing_dneskai_plan_head_revision on public.marketing_dneskai_plan(head_revision_id) where head_revision_id is not null;

alter table public.marketing_dneskai_plan enable row level security;
revoke all on public.marketing_dneskai_plan from public,anon,authenticated;
grant select on public.marketing_dneskai_plan to authenticated;
grant all on public.marketing_dneskai_plan to service_role;
create policy owner_read on public.marketing_dneskai_plan for select to authenticated using ((select auth.uid())=user_id);
create trigger collection_ownership before insert or update on public.marketing_dneskai_plan for each row execute function public.marketing_dneskai_ownership();

-- Every revision and topic the plan names belongs to the row's owner.
create function marketing_private.dneskai_plan_ownership() returns trigger language plpgsql set search_path='' as $$
begin
 if new.revision_id is not null and not exists(select 1 from public.marketing_revisions where id=new.revision_id and user_id=new.user_id and brand='dneskai') then raise exception 'foreign plan revision'; end if;
 if new.head_revision_id is not null and not exists(select 1 from public.marketing_revisions where id=new.head_revision_id and user_id=new.user_id and brand='dneskai') then raise exception 'foreign plan revision'; end if;
 if new.threads_revision_id is not null and not exists(select 1 from public.marketing_revisions where id=new.threads_revision_id and user_id=new.user_id and brand='dneskai') then raise exception 'foreign plan revision'; end if;
 if new.topic_id is not null and not exists(select 1 from public.marketing_dneskai_topics where id=new.topic_id and user_id=new.user_id and project_id=new.project_id) then raise exception 'foreign plan topic'; end if;
 new.updated_at:=clock_timestamp();
 return new;
end $$;
revoke all on function marketing_private.dneskai_plan_ownership() from public,anon,authenticated;
create trigger plan_ownership before insert or update on public.marketing_dneskai_plan for each row execute function marketing_private.dneskai_plan_ownership();

-- The owner's approval, given by the plan for the owner (owner decision, 7 November 2026: the owner approved every
-- education topic and the last week's news into the plan). The same checks as marketing_approve_revision, for the
-- service role only, and only for a revision the plan names as a slot's post or its Threads twin.
create function public.marketing_dneskai_plan_approve(p_owner uuid,p_revision_id uuid,p_expected_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.marketing_revisions; publication uuid; expected_campaign uuid; expected_entry uuid;
begin
 select * into r from public.marketing_revisions where id=p_revision_id and user_id=p_owner and brand='dneskai';
 if not found then raise exception 'revision unavailable'; end if;
 if not exists(select 1 from public.marketing_dneskai_plan p where p.user_id=p_owner and (p.head_revision_id=r.id or p.threads_revision_id=r.id)) then raise exception 'revision not planned'; end if;
 expected_campaign:=r.campaign_id;
 expected_entry:=r.calendar_entry_id;
 if not public.marketing_revision_campaign_active(r.user_id,expected_campaign,expected_entry) then raise exception 'campaign inactive'; end if;
 select * into r from public.marketing_revisions where id=p_revision_id and user_id=p_owner for update;
 if not found then raise exception 'revision unavailable'; end if;
 if r.campaign_id is distinct from expected_campaign or r.calendar_entry_id is distinct from expected_entry then raise exception 'revision changed'; end if;
 if r.content_hash<>p_expected_hash then raise exception 'revision changed'; end if;
 if r.status not in ('review','approved') or not r.ready then raise exception 'revision not ready'; end if;
 if marketing_private.render_report_blocks(r.render_report) then raise exception 'render blocked'; end if;
 if jsonb_typeof(r.revision->'deck')='object' and (jsonb_typeof(r.revision->'assets') is distinct from 'array'
  or jsonb_array_length(r.revision->'assets')<>jsonb_array_length(r.revision->'deck'->'slides')) then raise exception 'revision not ready'; end if;
 if (r.revision->>'scheduledAt')::timestamptz<=now() then raise exception 'schedule expired'; end if;
 if not public.marketing_sources_valid(r.user_id,r.brand,r.revision,now(),false) then raise exception 'source changed'; end if;
 if not exists(select 1 from public.marketing_accounts a where a.user_id=r.user_id and a.brand=r.brand
   and a.remote_account_id=r.revision->'account'->>'id' and a.platform=r.revision->'account'->>'platform'
   and a.handle=r.revision->'account'->>'handle' and a.verified_at is not null) then raise exception 'account unverified'; end if;
 if r.status='approved' then
  select id into publication from public.marketing_publications where revision_id=r.id and user_id=r.user_id;
  if not found then raise exception 'publication unavailable'; end if;
  return publication;
 end if;
 update public.marketing_revisions set status='approved',approved_at=coalesce(approved_at,now()),approved_hash=content_hash where id=r.id;
 insert into public.marketing_publications(user_id,revision_id,platform,scheduled_at)
 values(r.user_id,r.id,r.revision->'account'->>'platform',(r.revision->>'scheduledAt')::timestamptz)
 on conflict(revision_id,platform) do nothing;
 select id into publication from public.marketing_publications where revision_id=r.id;
 insert into public.marketing_events(user_id,revision_id,kind,payload) values(r.user_id,r.id,'approved',jsonb_build_object('publicationId',publication,'by','dneskai-plan'));
 return publication;
end $$;
revoke all on function public.marketing_dneskai_plan_approve(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_plan_approve(uuid,uuid,text) to service_role;

-- A Threads twin the plan no longer wants (its Instagram post changed): skipped, and its queued publication cancelled.
-- Never one that is publishing or published.
create function public.marketing_dneskai_plan_retire(p_owner uuid,p_revision_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.marketing_revisions;
begin
 select * into r from public.marketing_revisions where id=p_revision_id and user_id=p_owner and brand='dneskai' for update;
 if not found then return false; end if;
 if r.status not in ('review','approved','returned','failed') or exists(select 1 from public.marketing_publications where revision_id=r.id and status in ('claimed','published','reconciliation')) then return false; end if;
 update public.marketing_revisions set status='skipped',approved_at=null,approved_hash=null,feedback='dneskai-plan-replaced' where id=r.id;
 update public.marketing_publications set status='cancelled' where revision_id=r.id and status='queued';
 insert into public.marketing_events(user_id,revision_id,kind,payload) values(r.user_id,r.id,'skipped',jsonb_build_object('by','dneskai-plan'));
 return true;
end $$;
revoke all on function public.marketing_dneskai_plan_retire(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_plan_retire(uuid,uuid) to service_role;

-- A news post in the plan goes out after its 48-hour window: the brief it was drafted from stays current until a day
-- after its slot. Only `expiresAt` changes; the packet's content hash does not cover it, so the approval stays bound.
create function public.marketing_dneskai_plan_extend_brief(p_owner uuid,p_event text,p_until timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if p_until>now()+interval '45 days' then raise exception 'extension too long'; end if;
 update public.marketing_dneskai_briefs set brief=jsonb_set(brief,'{expiresAt}',to_jsonb(to_char(p_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),updated_at=clock_timestamp()
  where user_id=p_owner and event_id=p_event and status<>'skipped' and (brief->>'expiresAt')::timestamptz<p_until;
 get diagnostics changed=row_count;
 return changed;
end $$;
revoke all on function public.marketing_dneskai_plan_extend_brief(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_plan_extend_brief(uuid,text,timestamptz) to service_role;
