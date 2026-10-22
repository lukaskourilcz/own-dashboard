-- SEL-10 (decision-free half): an event's category is the majority over its eligible members, with tier-0/1
-- sources breaking ties, instead of the category Jev gave its single most relevant member. The TypeScript
-- grouping (dneskaiEventCategory in src/lib/marketing/dneskai-events.ts) derives it and sends it as an optional
-- `category` of each p_events entry; this replaces marketing_dneskai_finish with a version that uses it.
-- The deployed function ignores the extra key and keeps the lead's category, so the code deploys before this
-- migration. Unchanged: the lead report, the per-report 48 h / 30 d eligibility window, the one-per-category
-- diversity rule (tool and ai-project stay separate categories) and each report's own Jev label.
-- NOT APPLIED: production migration history differs from the repository; apply only in an approved rollout.

create or replace function public.marketing_dneskai_finish(p_owner uuid,p_run uuid,p_fence uuid,p_status text,p_error text,p_events jsonb default null) returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;total numeric;unknown_cost boolean;e jsonb;members text[];seen text[]:='{}';membership jsonb:='{}';categories jsonb:='{}';chosen jsonb;covered jsonb;ev jsonb;selected_ids text[];overflow_ids text[];
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
    -- New (SEL-10): the event's category as the caller derived it (majority over eligible members, tier-0/1 sources
    -- breaking ties). Optional; an unknown value is ignored and the lead's category applies.
    if e->>'category' in('ai-news','tech-news','tool','ai-project','marketing') then categories:=categories||jsonb_build_object(e->>'eventId',e->>'category');end if;
   end loop;
  end if;
  -- Changed: up to four EVENTS, one per category first, then relevance; fewer is fine. An event is led by its
  -- best eligible report (the former candidate conditions). An event that already contains a selected
  -- report, or a Jev duplicate whose link leaves the event and ends at a selected report or a DNESKAi revision
  -- (dneskai_covering_id), was covered before and is never selected. A Jev duplicate of a held, rejected or
  -- still open report covers nothing.
  with pool as (
   select c.id,c.status,c.candidate,coalesce(membership->>c.id,marketing_private.dneskai_event_id(c.id)) as event_id
   from public.marketing_dneskai_candidates c where c.user_id=p_owner and c.project_id=r.project_id and (c.status='new' or membership?c.id)
  ), eligible as (
   select * from pool where status='new' and candidate->>'category' is not null and candidate->>'category'<>'other' and (candidate->>'relevance')::numeric>=0.85 and candidate->>'duplicateOf' is null and candidate->>'reason' is null and candidate->>'publishedAt' is not null
    and (candidate->>'publishedAt')::timestamptz<=clock_timestamp()
    and (candidate->>'publishedAt')::timestamptz>=clock_timestamp()-case when candidate->>'category' in('ai-news','tech-news') then interval '48 hours' else interval '30 days' end
  ), heads as (
   select distinct on(event_id) event_id,id as lead_id,candidate->>'category' as category,(candidate->>'relevance')::numeric as relevance,(candidate->>'publishedAt')::timestamptz as published_at
   from eligible order by event_id,(candidate->>'relevance')::numeric desc,(candidate->>'publishedAt')::timestamptz desc,id collate "C"
  ), leads as (
   -- Changed (SEL-10): the lead stays the most relevant eligible report, but the event's category is the one the
   -- grouping derived, when at least one eligible member of the event carries it; otherwise the lead's, as before.
   select h.event_id,h.lead_id,coalesce((select categories->>h.event_id from eligible x where x.event_id=h.event_id and x.candidate->>'category'=categories->>h.event_id limit 1),h.category) as category,h.relevance,h.published_at
   from heads h
  ), scored as (
   select l.*,(select x.covering from (select case when p.status='selected' then p.id else marketing_private.dneskai_covering_id(p_owner,r.project_id,p.candidate->>'duplicateOf') end as covering,p.id
     from pool p where p.event_id=l.event_id and (p.status='selected' or (p.status='duplicate'
      and not exists(select 1 from pool q where q.event_id=l.event_id and q.id=p.candidate->>'duplicateOf')))) x
     where x.covering is not null order by x.id collate "C" limit 1) as covered_by
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
