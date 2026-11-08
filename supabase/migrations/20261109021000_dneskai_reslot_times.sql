-- New DNESKAi times (owner decision, 8 November 2026): an owner's reslot of a lapsed brief takes 08:00, 12:30, 19:00
-- or 21:00 (DNESKAI_BRIEF_SLOTS); the function is otherwise the one of 20261022141512.
create or replace function public.marketing_dneskai_reslot_brief(p_brief uuid,p_value jsonb,p_scheduled_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid());b public.marketing_dneskai_briefs;v_lead public.marketing_dneskai_candidates;
 today date:=(clock_timestamp() at time zone 'Europe/Prague')::date;target date;news_window interval;
begin
 if v_owner is null or p_scheduled_at is null then raise exception 'brief unavailable';end if;
 select * into b from public.marketing_dneskai_briefs where id=p_brief and user_id=v_owner for update;
 if not found then raise exception 'brief unavailable';end if;
 -- Only a lapse: the slot or the day passed, or the day had no free slot. A repeat, an invalid brief, changed members
 -- or an expired brief stay closed.
 if b.status<>'skipped' or coalesce(b.code,'') not in('brief-slot-passed','brief-target-date-passed','brief-slot-unavailable') then raise exception 'brief not reslottable';end if;
 -- Never after an admission attempt: a source head, calendar entry, job or revision keeps its own lineage.
 if b.job_id is not null or b.calendar_entry_id is not null
  or exists(select 1 from public.marketing_sources s where s.user_id=v_owner and s.brand='dneskai' and s.source_id=b.event_id)
  or exists(select 1 from public.marketing_jobs j where j.user_id=v_owner and j.request->'generation'->'source'->>'brand'='dneskai' and j.request->'generation'->'source'->>'sourceId'=b.event_id)
  or exists(select 1 from public.marketing_revisions v where v.user_id=v_owner and v.brand='dneskai'
   and exists(select 1 from jsonb_array_elements(v.revision->'sources') ref where ref->>'sourceId'=b.event_id)) then raise exception 'brief admitted';end if;
 -- One of the four daily Prague slots, today or tomorrow, at least 30 minutes ahead (DNESKAI_BRIEF_SLOTS, MIN_LEAD).
 target:=(p_scheduled_at at time zone 'Europe/Prague')::date;
 if target not in(today,today+1) or to_char(p_scheduled_at at time zone 'Europe/Prague','HH24:MI') not in('08:00','12:30','19:00','21:00')
  or p_scheduled_at<clock_timestamp()+interval '30 minutes' then raise exception 'brief slot invalid';end if;
 -- The same document checks as marketing_dneskai_prepare_brief, for the new day. A built brief keeps its expiry,
 -- so moving it never makes its evidence look fresher than when it was first observed.
 if jsonb_typeof(p_value) is distinct from 'object' or coalesce(p_value->>'schemaVersion','') not in('dneskai-brief/1','dneskai-brief/2') or p_value->>'eventId' is distinct from b.event_id
  or p_value->>'memberHash' is distinct from b.member_hash or p_value->>'targetDate' is distinct from target::text or p_value->>'category' is distinct from b.category
  or jsonb_typeof(p_value->'evidence') is distinct from 'array' or jsonb_array_length(p_value->'evidence') not between 1 and 30
  or exists(select 1 from jsonb_array_elements(p_value->'evidence') x where not (x->>'candidateId'=any(b.member_ids)))
  or (p_value->>'scheduledAt')::timestamptz is distinct from p_scheduled_at or coalesce(p_value->>'expiresAt','')=''
  or (p_value->>'expiresAt')::timestamptz<=p_scheduled_at
  or (b.brief is not null and (p_value->>'expiresAt')::timestamptz>(b.brief->>'expiresAt')::timestamptz) then raise exception 'brief invalid';end if;
 if marketing_private.dneskai_member_hash(v_owner,b.project_id,b.member_ids)<>b.member_hash then raise exception 'brief members changed';end if;
 -- Every member still belongs to this brief alone: selected for its old day, or released by the lapse path
 -- (20261022021835) and not picked up since.
 if exists(select 1 from unnest(b.member_ids) m(id) where not exists(select 1 from public.marketing_dneskai_candidates c where c.user_id=v_owner and c.project_id=b.project_id and c.id=m.id
   and ((c.status='selected' and c.target_date=b.target_date) or (c.status='new' and c.target_date is null))))
  or exists(select 1 from public.marketing_dneskai_briefs other where other.user_id=v_owner and other.project_id=b.project_id and other.id<>b.id and other.status<>'skipped' and other.member_ids&&b.member_ids)
  then raise exception 'brief members changed';end if;
 -- The window of the nightly selection, checked again now: 48 hours for news, 30 days otherwise.
 news_window:=case when b.category in('ai-news','tech-news') then interval '48 hours' else interval '30 days' end;
 select * into v_lead from public.marketing_dneskai_candidates where user_id=v_owner and project_id=b.project_id and id=b.lead_candidate_id;
 if not found or coalesce(v_lead.candidate->>'publishedAt','')='' or (v_lead.candidate->>'publishedAt')::timestamptz>clock_timestamp()
  or (v_lead.candidate->>'publishedAt')::timestamptz<clock_timestamp()-news_window then raise exception 'brief outside window';end if;
 update public.marketing_dneskai_candidates c set status='selected',target_date=target,updated_at=clock_timestamp(),
  candidate=c.candidate||jsonb_build_object('status','selected','targetDate',target::text,'reason','research-selection-not-fact-checked','duplicateOf',null)
  where c.user_id=v_owner and c.project_id=b.project_id and c.id=any(b.member_ids);
 -- pending, so the scheduler picks the brief up; it says why it waits when no verified @dneskai account exists.
 update public.marketing_dneskai_briefs set target_date=target,scheduled_at=p_scheduled_at,brief=p_value,status='pending',updated_at=clock_timestamp(),
  code=case when exists(select 1 from public.marketing_accounts a where a.user_id=v_owner and a.brand='dneskai' and a.platform='instagram' and a.verified_at is not null) then 'owner-reslot' else 'account-unavailable' end
  where id=b.id returning * into b;
 return jsonb_build_object('id',b.id,'status',b.status,'code',b.code,'targetDate',b.target_date,'scheduledAt',b.scheduled_at);
end $$;
revoke all on function public.marketing_dneskai_reslot_brief(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_reslot_brief(uuid,jsonb,timestamptz) to authenticated;
