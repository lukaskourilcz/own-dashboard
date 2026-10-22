-- #115: DNESKAi events and social briefs. Selected research candidates become briefs without any article.
-- Research selection is not fact verification and not approval: a brief reaches marketing_jobs only through
-- the existing guarded marketing_enqueue_job path (calendar entry current, 8 jobs per rolling 24 hours), and
-- the owner still approves the exact rendered revision. No publication authority is added here.
--
-- The applied migration 20261013165236 stays untouched. marketing_dneskai_finish is replaced below with its
-- current body plus the marked changes; no later migration redefined it (#112 and #113 changed admit,
-- claim_stage and save_stage only).

-- One row per selected event and target date. The brief document itself is validated in TypeScript
-- (DneskaiBriefSchema, dneskai-brief/1); SQL checks only its identity against the row.
create table public.marketing_dneskai_briefs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 run_id uuid not null references public.marketing_dneskai_runs(id) on delete cascade,
 event_id text not null check(event_id ~ '^[a-f0-9]{64}$'),
 target_date date not null,
 rank integer not null check(rank between 1 and 4),
 category text not null check(category in('ai-news','tech-news','marketing','tool','ai-project')),
 member_ids text[] not null check(cardinality(member_ids) between 1 and 8),
 lead_candidate_id text not null,
 member_hash text not null check(member_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'pending' check(status in('pending','ready','queued','skipped')),
 code text check(code ~ '^[a-z0-9-]{1,64}$'),
 brief jsonb check(brief is null or jsonb_typeof(brief)='object'),
 scheduled_at timestamptz,
 calendar_entry_id uuid references public.marketing_calendar_entries(id) on delete set null,
 job_id uuid references public.marketing_jobs(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(user_id,project_id,event_id,target_date),
 unique(run_id,rank),
 check(lead_candidate_id=any(member_ids)),
 check(status not in('ready','queued') or (brief is not null and scheduled_at is not null)),
 check(status<>'queued' or job_id is not null)
);
-- A publishing slot holds one brief per owner and project.
create unique index marketing_dneskai_brief_slot on public.marketing_dneskai_briefs(user_id,project_id,scheduled_at) where scheduled_at is not null and status<>'skipped';
create index marketing_dneskai_briefs_owner_date on public.marketing_dneskai_briefs(user_id,project_id,target_date desc);
create index marketing_dneskai_briefs_event on public.marketing_dneskai_briefs(user_id,event_id);
alter table public.marketing_dneskai_briefs enable row level security;
revoke all on public.marketing_dneskai_briefs from public,anon,authenticated;
grant select on public.marketing_dneskai_briefs to authenticated;
grant all on public.marketing_dneskai_briefs to service_role;
create policy owner_read on public.marketing_dneskai_briefs for select to authenticated using ((select auth.uid())=user_id);
-- project_id and run_id ownership, the same check the other collection tables use.
create trigger collection_ownership before insert or update on public.marketing_dneskai_briefs for each row execute function public.marketing_dneskai_ownership();

-- The same identities dneskai-events.ts computes: eventId from the earliest collected member, memberHash over
-- the sorted "id:contentHash" lines. Byte order ("C") matches the JavaScript sort of the hex ids.
create function marketing_private.dneskai_event_id(p_anchor text) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to('dneskai-event/1'||chr(10)||p_anchor,'UTF8')),'hex')
$$;
create function marketing_private.dneskai_member_hash(p_owner uuid,p_project uuid,p_ids text[]) returns text language sql stable set search_path='' as $$
 select encode(sha256(convert_to('dneskai-event-members/1'||chr(10)||coalesce(string_agg(c.id||':'||c.content_hash,chr(10) order by c.id||':'||c.content_hash collate "C"),''),'UTF8')),'hex')
 from public.marketing_dneskai_candidates c where c.user_id=p_owner and c.project_id=p_project and c.id=any(p_ids)
$$;
-- What a Jev duplicate link really points at: follow duplicateOf through duplicate reports (at most eight links)
-- and return the end only when it is a selected report or a DNESKAi revision of the owner. A link that ends at a
-- held, rejected, new or unknown report covers nothing, so a report Jev folded into an unselected one never hides
-- a later eligible report of the same event.
create function marketing_private.dneskai_covering_id(p_owner uuid,p_project uuid,p_target text) returns text language sql stable set search_path='' as $$
 with recursive chain(id,depth) as (
  select p_target,0 where p_target is not null
  union all
  select c.candidate->>'duplicateOf',chain.depth+1 from chain join public.marketing_dneskai_candidates c on c.user_id=p_owner and c.project_id=p_project and c.id=chain.id
  where c.status='duplicate' and coalesce(c.candidate->>'duplicateOf','')<>'' and chain.depth<8
 ), terminal as (select id from chain order by depth desc limit 1)
 select t.id from terminal t
 where exists(select 1 from public.marketing_dneskai_candidates c where c.user_id=p_owner and c.project_id=p_project and c.id=t.id and c.status='selected')
  or (t.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and exists(select 1 from public.marketing_revisions v where v.user_id=p_owner and v.brand='dneskai' and v.id=t.id::uuid))
$$;
revoke all on function marketing_private.dneskai_event_id(text),marketing_private.dneskai_member_hash(uuid,uuid,text[]),marketing_private.dneskai_covering_id(uuid,uuid,text) from public,anon,authenticated;
grant execute on function marketing_private.dneskai_event_id(text),marketing_private.dneskai_member_hash(uuid,uuid,text[]),marketing_private.dneskai_covering_id(uuid,uuid,text) to service_role;
