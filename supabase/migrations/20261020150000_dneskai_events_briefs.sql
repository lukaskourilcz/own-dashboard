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
revoke all on function marketing_private.dneskai_event_id(text),marketing_private.dneskai_member_hash(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function marketing_private.dneskai_event_id(text),marketing_private.dneskai_member_hash(uuid,uuid,text[]) to service_role;

-- Changed signature: p_events carries the TypeScript grouping (only events with two or more members).
-- A call without it treats every candidate as its own event, which is the former selection.
drop function public.marketing_dneskai_finish(uuid,uuid,uuid,text,text);
create function public.marketing_dneskai_finish(p_owner uuid,p_run uuid,p_fence uuid,p_status text,p_error text,p_events jsonb default null) returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;total numeric;unknown_cost boolean;e jsonb;members text[];seen text[]:='{}';membership jsonb:='{}';chosen jsonb;covered jsonb;ev jsonb;selected_ids text[];overflow_ids text[];
begin
 select * into r from public.marketing_dneskai_runs where id=p_run and user_id=p_owner and fence=p_fence and lease_until>clock_timestamp() for update;if not found then raise exception 'collection fence unavailable';end if;
 if p_status not in('running','complete','partial','held','failed') then raise exception 'collection status invalid';end if;
 select coalesce(sum(cost_usd),0),coalesce(bool_or(reserved_usd>0 and cost_usd is null),false) into total,unknown_cost from public.marketing_dneskai_stages where run_id=p_run;
 if p_status<>'running' and not unknown_cost and r.date=(clock_timestamp() at time zone 'Europe/Prague')::date then
  -- New: validate the grouping. Every event is named by its anchor and no candidate is in two events.
  if p_events is not null then
   if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>300 then raise exception 'collection events invalid';end if;
   for e in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(e->'memberIds') is distinct from 'array' or jsonb_array_length(e->'memberIds') not between 2 and 300 or coalesce(e->>'anchorId','')=''
     or e->>'eventId' is distinct from marketing_private.dneskai_event_id(e->>'anchorId') then raise exception 'collection events invalid';end if;
    select array_agg(value#>>'{}') into members from jsonb_array_elements(e->'memberIds');
    if not (e->>'anchorId'=any(members)) or members&&seen or (select count(distinct x) from unnest(members) x)<>cardinality(members) then raise exception 'collection events invalid';end if;
    seen:=seen||members;
    membership:=membership||(select jsonb_object_agg(x,e->>'eventId') from unnest(members) x);
   end loop;
  end if;
  -- Changed: up to four EVENTS, one per category first, then relevance; fewer is fine. An event is led by its
  -- best eligible report (the former candidate conditions). An event that already contains a selected
  -- report, or a Jev duplicate of something outside the event, was covered before and is never selected.
  with pool as (
   select c.id,c.status,c.candidate,coalesce(membership->>c.id,marketing_private.dneskai_event_id(c.id)) as event_id
   from public.marketing_dneskai_candidates c where c.user_id=p_owner and c.project_id=r.project_id and (c.status='new' or membership?c.id)
  ), eligible as (
   select * from pool where status='new' and candidate->>'category' is not null and candidate->>'category'<>'other' and (candidate->>'relevance')::numeric>=0.85 and candidate->>'duplicateOf' is null and candidate->>'reason' is null and candidate->>'publishedAt' is not null
    and (candidate->>'publishedAt')::timestamptz<=clock_timestamp()
    and (candidate->>'publishedAt')::timestamptz>=clock_timestamp()-case when candidate->>'category' in('ai-news','tech-news') then interval '48 hours' else interval '30 days' end
  ), leads as (
   select distinct on(event_id) event_id,id as lead_id,candidate->>'category' as category,(candidate->>'relevance')::numeric as relevance,(candidate->>'publishedAt')::timestamptz as published_at
   from eligible order by event_id,(candidate->>'relevance')::numeric desc,(candidate->>'publishedAt')::timestamptz desc,id collate "C"
  ), scored as (
   select l.*,(select coalesce(case when p.status='selected' then p.id else p.candidate->>'duplicateOf' end,p.id) from pool p where p.event_id=l.event_id and
     (p.status='selected' or (p.status='duplicate' and not exists(select 1 from pool q where q.event_id=l.event_id and q.id=p.candidate->>'duplicateOf')))
     order by p.id collate "C" limit 1) as covered_by
   from leads l
  ), ranked as (
   select s.*,row_number() over(partition by category order by relevance desc,published_at desc,event_id) as category_rank from scored s where covered_by is null
  ), picked as (
   select event_id,lead_id,category,row_number() over(order by category_rank,relevance desc,published_at desc,event_id) as rank
   from ranked order by category_rank,relevance desc,published_at desc,event_id limit 4
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('eventId',p.event_id,'leadId',p.lead_id,'category',p.category,'rank',p.rank) order by p.rank),'[]') from picked p),
         (select coalesce(jsonb_agg(jsonb_build_object('eventId',s.event_id,'coveredBy',s.covered_by)),'[]') from scored s where s.covered_by is not null)
  into chosen,covered;
  -- New: every classified report of a chosen event is selected for the target day (media are collected for
  -- selected candidates only), at most eight; a ninth or later report is folded into the lead as a duplicate.
  for ev in select value from jsonb_array_elements(chosen) loop
   select array_agg(id order by ord) into selected_ids from (
    select id,row_number() over(order by (id=ev->>'leadId') desc,(status='new' and (candidate->>'relevance')::numeric>=0.85) desc,(candidate->>'relevance')::numeric desc nulls last,(candidate->>'publishedAt')::timestamptz desc nulls last,id collate "C") as ord
    from (select c.id,c.status,c.candidate from public.marketing_dneskai_candidates c where c.user_id=p_owner and c.project_id=r.project_id and c.status in('new','duplicate')
      and coalesce(membership->>c.id,marketing_private.dneskai_event_id(c.id))=ev->>'eventId' and c.candidate->>'category' is not null and c.candidate->>'category'<>'other') m
   ) ordered;
   overflow_ids:=selected_ids[9:];selected_ids:=selected_ids[1:8];
   update public.marketing_dneskai_candidates set status='selected',target_date=r.target_date,updated_at=clock_timestamp(),
    candidate=jsonb_set(jsonb_set(jsonb_set(candidate,'{status}','"selected"'),'{targetDate}',to_jsonb(r.target_date::text)),'{reason}','"research-selection-not-fact-checked"')
    where user_id=p_owner and project_id=r.project_id and id=any(selected_ids);
   if cardinality(overflow_ids)>0 then
    update public.marketing_dneskai_candidates set status='duplicate',updated_at=clock_timestamp(),
     candidate=jsonb_set(jsonb_set(jsonb_set(candidate,'{status}','"duplicate"'),'{duplicateOf}',to_jsonb(ev->>'leadId')),'{reason}','"collection-event-member-overflow"')
     where user_id=p_owner and project_id=r.project_id and id=any(overflow_ids);
   end if;
   insert into public.marketing_dneskai_briefs(user_id,project_id,run_id,event_id,target_date,rank,category,member_ids,lead_candidate_id,member_hash)
   values(p_owner,r.project_id,p_run,ev->>'eventId',r.target_date,(ev->>'rank')::int,ev->>'category',selected_ids,ev->>'leadId',marketing_private.dneskai_member_hash(p_owner,r.project_id,selected_ids))
   on conflict do nothing;
  end loop;
  -- New: the open reports of an already covered event are marked as duplicates of what covered it.
  for ev in select value from jsonb_array_elements(covered) loop
   update public.marketing_dneskai_candidates c set updated_at=clock_timestamp(),status='duplicate',
    candidate=jsonb_set(jsonb_set(jsonb_set(c.candidate,'{status}','"duplicate"'),'{duplicateOf}',to_jsonb(ev->>'coveredBy')),'{reason}','"collection-already-covered"')
    where c.user_id=p_owner and c.project_id=r.project_id and c.status='new' and c.candidate->>'category' is not null
     and coalesce(membership->>c.id,marketing_private.dneskai_event_id(c.id))=ev->>'eventId';
  end loop;
  update public.marketing_dneskai_candidates set updated_at=clock_timestamp() where user_id=p_owner and project_id=r.project_id and target_date=r.target_date and status='selected';
  update public.marketing_dneskai_candidates set status='held',candidate=jsonb_set(jsonb_set(candidate,'{status}','"held"'),'{reason}','"collection-source-date-unavailable-or-stale"') where user_id=p_owner and project_id=r.project_id and status='new' and (candidate->>'publishedAt' is null or (candidate->>'publishedAt')::timestamptz<clock_timestamp()-case when candidate->>'category' in('ai-news','tech-news') then interval '48 hours' else interval '30 days' end);
 end if;
 -- Changed: selected_count counts the day's events (briefs), not its selected reports.
 update public.marketing_dneskai_runs set status=p_status,error_code=p_error,selected_count=(select count(*) from public.marketing_dneskai_briefs where user_id=p_owner and project_id=r.project_id and target_date=r.target_date),cost_usd=case when unknown_cost then null else total end,lease_until=null where id=p_run returning * into r;return to_jsonb(r);
end $$;
revoke all on function public.marketing_dneskai_finish(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_finish(uuid,uuid,uuid,text,text,jsonb) to service_role;

-- Stores the built brief (status ready, or pending with a hold code such as account-unavailable). The brief must
-- name this row's event, members, target day and category; its slot falls on the target Prague day. A null
-- p_brief keeps the stored document and changes only status and code.
create function public.marketing_dneskai_prepare_brief(p_owner uuid,p_brief uuid,p_value jsonb,p_scheduled_at timestamptz,p_status text,p_code text) returns jsonb language plpgsql set search_path='' as $$
declare b public.marketing_dneskai_briefs;v jsonb;
begin
 select * into b from public.marketing_dneskai_briefs where id=p_brief and user_id=p_owner for update;
 if not found then raise exception 'brief unavailable';end if;
 if b.status not in('pending','ready') then raise exception 'brief closed';end if;
 if p_status not in('pending','ready') or (p_code is not null and p_code !~ '^[a-z0-9-]{1,64}$') then raise exception 'brief state invalid';end if;
 v:=coalesce(p_value,b.brief);
 if v is null then
  if p_status<>'pending' then raise exception 'brief invalid';end if;
  update public.marketing_dneskai_briefs set status='pending',code=p_code,updated_at=clock_timestamp() where id=b.id returning * into b;
  return to_jsonb(b);
 end if;
 if jsonb_typeof(v) is distinct from 'object' or v->>'schemaVersion' is distinct from 'dneskai-brief/1' or v->>'eventId' is distinct from b.event_id
  or v->>'memberHash' is distinct from b.member_hash or v->>'targetDate' is distinct from b.target_date::text or v->>'category' is distinct from b.category
  or jsonb_typeof(v->'evidence') is distinct from 'array' or jsonb_array_length(v->'evidence') not between 1 and 30
  or exists(select 1 from jsonb_array_elements(v->'evidence') x where not (x->>'candidateId'=any(b.member_ids)))
  or (v->>'scheduledAt')::timestamptz is distinct from coalesce(p_scheduled_at,b.scheduled_at) then raise exception 'brief invalid';end if;
 if (coalesce(p_scheduled_at,b.scheduled_at) at time zone 'Europe/Prague')::date<>b.target_date then raise exception 'brief slot invalid';end if;
 if marketing_private.dneskai_member_hash(p_owner,b.project_id,b.member_ids)<>b.member_hash then raise exception 'brief members changed';end if;
 update public.marketing_dneskai_briefs set brief=v,scheduled_at=coalesce(p_scheduled_at,b.scheduled_at),status=p_status,code=p_code,updated_at=clock_timestamp() where id=b.id returning * into b;
 return to_jsonb(b);
end $$;

-- Closes a brief without a job. With p_duplicate_of (a repeat of a recent post) its selected reports become
-- duplicates with reason collection-already-covered, so they never come back as a new topic.
create function public.marketing_dneskai_skip_brief(p_owner uuid,p_brief uuid,p_code text,p_duplicate_of text default null) returns jsonb language plpgsql set search_path='' as $$
declare b public.marketing_dneskai_briefs;
begin
 select * into b from public.marketing_dneskai_briefs where id=p_brief and user_id=p_owner for update;
 if not found then raise exception 'brief unavailable';end if;
 if b.status='skipped' then return to_jsonb(b);end if;
 if b.status not in('pending','ready') then raise exception 'brief closed';end if;
 if coalesce(p_code,'') !~ '^[a-z0-9-]{1,64}$' or length(p_duplicate_of)>200 then raise exception 'brief state invalid';end if;
 if p_duplicate_of is not null then
  update public.marketing_dneskai_candidates set status='duplicate',target_date=null,updated_at=clock_timestamp(),
   candidate=jsonb_set(jsonb_set(jsonb_set(jsonb_set(candidate,'{status}','"duplicate"'),'{targetDate}','null'),'{duplicateOf}',to_jsonb(p_duplicate_of)),'{reason}','"collection-already-covered"')
   where user_id=p_owner and project_id=b.project_id and id=any(b.member_ids) and status='selected' and target_date=b.target_date;
 end if;
 update public.marketing_dneskai_briefs set status='skipped',code=p_code,updated_at=clock_timestamp() where id=b.id returning * into b;
 return to_jsonb(b);
end $$;

-- Admission without the article pipeline: the owner's active "DNESKAi daily" campaign (created once, never
-- taking over another active DNESKAi campaign) and one planned calendar entry per brief, bound to the brief's
-- ingested source head. marketing_enqueue_job then applies its usual calendar and daily-budget checks.
create function public.marketing_dneskai_admit_brief(p_owner uuid,p_brief uuid,p_source uuid) returns jsonb language plpgsql set search_path='' as $$
declare b public.marketing_dneskai_briefs;s public.marketing_sources;c public.marketing_campaigns;en public.marketing_calendar_entries;
 today date:=(clock_timestamp() at time zone 'Europe/Prague')::date;daily_hash text:=encode(sha256(convert_to('dneskai-daily-briefs/1','UTF8')),'hex');
 v_local_time text;v_kind text;
begin
 select * into b from public.marketing_dneskai_briefs where id=p_brief and user_id=p_owner for update;
 if not found then raise exception 'brief unavailable';end if;
 if b.status<>'ready' or b.brief is null or b.scheduled_at is null then raise exception 'brief not ready';end if;
 if b.scheduled_at<=clock_timestamp() then raise exception 'brief slot passed';end if;
 select * into s from public.marketing_sources where id=p_source and user_id=p_owner and brand='dneskai' and source_id=b.event_id
  and source_revision=b.member_hash and eligible and (expires_at is null or expires_at>clock_timestamp()) and packet->>'kind'='brief';
 if not found then raise exception 'brief source unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-daily-campaign',0));
 select * into c from public.marketing_campaigns where user_id=p_owner and brand='dneskai' and status='active';
 if found and c.source_hash<>daily_hash then raise exception 'brief campaign conflict';end if;
 if not found then
  insert into public.marketing_campaigns(user_id,project_id,brand,name,starts_on,ends_on,time_zone,source_snapshot,source_hash,status)
  values(p_owner,b.project_id,'dneskai','DNESKAi daily',today,today+3650,'Europe/Prague',jsonb_build_object('schemaVersion','dneskai-daily-briefs/1','kind','brief'),daily_hash,'active')
  on conflict(user_id,brand,source_hash,starts_on) do update set status='active' returning * into c;
 end if;
 if b.target_date<c.starts_on or b.target_date>c.ends_on then raise exception 'brief campaign conflict';end if;
 v_local_time:=to_char(b.scheduled_at at time zone 'Europe/Prague','HH24:MI');
 v_kind:=case when b.brief->>'suggestedFormat'='single-image' then 'post' else 'carousel' end;
 insert into public.marketing_calendar_entries(user_id,campaign_id,source_id,date,local_time,kind,platform,title,original,status,needs_review,bound_source_id)
 values(p_owner,c.id,'brief:'||b.target_date::text||':'||b.event_id,b.target_date,v_local_time,v_kind,'instagram',left(coalesce(b.brief->>'title',''),300),
  jsonb_build_object('schemaVersion','dneskai-brief-entry/1','briefId',b.id,'eventId',b.event_id,'title',b.brief->>'title','category',b.category,'suggestedFormat',b.brief->>'suggestedFormat','evidenceCount',jsonb_array_length(b.brief->'evidence'),'mediaCount',jsonb_array_length(coalesce(b.brief->'media','[]'))),
  'planned',false,s.id)
 on conflict(campaign_id,source_id) do nothing;
 select * into en from public.marketing_calendar_entries where campaign_id=c.id and source_id='brief:'||b.target_date::text||':'||b.event_id and user_id=p_owner for update;
 if not found or en.status<>'planned' or en.needs_review or en.date<>b.target_date or en.local_time is distinct from v_local_time or en.kind<>v_kind or en.platform<>'instagram' then raise exception 'brief entry changed';end if;
 if en.bound_source_id is distinct from s.id then update public.marketing_calendar_entries set bound_source_id=s.id where id=en.id returning * into en;end if;
 update public.marketing_dneskai_briefs set calendar_entry_id=en.id,updated_at=clock_timestamp() where id=b.id;
 return jsonb_build_object('campaignId',c.id,'entryId',en.id,'entryVersion',en.generation_version,'scheduledAt',b.scheduled_at);
end $$;

-- Records the job marketing_enqueue_job created for the brief's calendar entry.
create function public.marketing_dneskai_brief_queued(p_owner uuid,p_brief uuid,p_job uuid) returns jsonb language plpgsql set search_path='' as $$
declare b public.marketing_dneskai_briefs;
begin
 select * into b from public.marketing_dneskai_briefs where id=p_brief and user_id=p_owner for update;
 if not found then raise exception 'brief unavailable';end if;
 if b.status='queued' and b.job_id=p_job then return to_jsonb(b);end if;
 if b.status<>'ready' then raise exception 'brief not ready';end if;
 if not exists(select 1 from public.marketing_jobs j where j.id=p_job and j.user_id=p_owner and j.request->'generation'->'source'->>'sourceId'=b.event_id
  and j.request->'generation'->'source'->>'kind'='brief' and j.request->>'calendarEntryId'=b.calendar_entry_id::text) then raise exception 'brief job unavailable';end if;
 update public.marketing_dneskai_briefs set status='queued',job_id=p_job,code=null,updated_at=clock_timestamp() where id=b.id returning * into b;
 return to_jsonb(b);
end $$;

-- The producer head of a brief source for refreshSource: the stored brief, its state and the current member
-- hash (selected reports for the target day only), so a changed or withdrawn member makes the brief ineligible.
create function public.marketing_dneskai_brief_source(p_owner uuid,p_event text,p_target date) returns jsonb language plpgsql stable set search_path='' as $$
declare b public.marketing_dneskai_briefs;n integer;current_ids text[];
begin
 select count(*) into n from public.marketing_dneskai_briefs where user_id=p_owner and event_id=p_event and target_date=p_target;
 if n<>1 then return null;end if;
 select * into b from public.marketing_dneskai_briefs where user_id=p_owner and event_id=p_event and target_date=p_target;
 select coalesce(array_agg(id),'{}') into current_ids from public.marketing_dneskai_candidates where user_id=p_owner and project_id=b.project_id and id=any(b.member_ids) and status='selected' and target_date=b.target_date;
 return jsonb_build_object('briefId',b.id,'projectId',b.project_id,'status',b.status,'code',b.code,'brief',b.brief,'memberHash',b.member_hash,
  'currentMemberHash',marketing_private.dneskai_member_hash(p_owner,b.project_id,current_ids),'memberCount',cardinality(b.member_ids),'currentMemberCount',cardinality(current_ids));
end $$;

revoke all on function public.marketing_dneskai_prepare_brief(uuid,uuid,jsonb,timestamptz,text,text),public.marketing_dneskai_skip_brief(uuid,uuid,text,text),public.marketing_dneskai_admit_brief(uuid,uuid,uuid),public.marketing_dneskai_brief_queued(uuid,uuid,uuid),public.marketing_dneskai_brief_source(uuid,text,date) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_prepare_brief(uuid,uuid,jsonb,timestamptz,text,text),public.marketing_dneskai_skip_brief(uuid,uuid,text,text),public.marketing_dneskai_admit_brief(uuid,uuid,uuid),public.marketing_dneskai_brief_queued(uuid,uuid,uuid),public.marketing_dneskai_brief_source(uuid,text,date) to service_role;
