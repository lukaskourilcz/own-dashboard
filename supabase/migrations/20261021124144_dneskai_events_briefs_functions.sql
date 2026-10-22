-- #115, part 3 of 3: the brief functions. See 20261021123547 and 20261021124058.
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
 v_local_time text;v_kind text;v_job uuid;
begin
 select * into b from public.marketing_dneskai_briefs where id=p_brief and user_id=p_owner for update;
 if not found then raise exception 'brief unavailable';end if;
 if b.status<>'ready' or b.brief is null or b.scheduled_at is null then raise exception 'brief not ready';end if;
 -- A retry after the job was created but not recorded on the brief returns that job, whatever the entry's state
 -- now, so the brief can record it instead of failing on a changed entry. A job of an older entry version
 -- (the entry was rebound since) does not count.
 if b.calendar_entry_id is not null then
  select * into en from public.marketing_calendar_entries where id=b.calendar_entry_id and user_id=p_owner;
  if found then
   select j.id into v_job from public.marketing_jobs j where j.user_id=p_owner and j.request->>'calendarEntryId'=en.id::text and j.request->>'calendarEntryVersion'=en.generation_version::text
    and j.request->'generation'->'source'->>'kind'='brief' and j.request->'generation'->'source'->>'sourceId'=b.event_id order by j.created_at desc,j.id limit 1;
   if v_job is not null then return jsonb_build_object('campaignId',en.campaign_id,'entryId',en.id,'entryVersion',en.generation_version,'scheduledAt',b.scheduled_at,'jobId',v_job);end if;
  end if;
 end if;
 if b.scheduled_at<=clock_timestamp() then raise exception 'brief slot passed';end if;
 select * into s from public.marketing_sources where id=p_source and user_id=p_owner and brand='dneskai' and source_id=b.event_id
  and source_revision=b.member_hash and eligible and (expires_at is null or expires_at>clock_timestamp()) and packet->>'kind'='brief';
 if not found then raise exception 'brief source unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-daily-campaign',0));
 -- marketing_one_active_campaign allows one active campaign per owner and brand, so this reads at most one row.
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
