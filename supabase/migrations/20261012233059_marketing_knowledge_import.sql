-- Owner-only source/evidence sidecars. Canonical tips stay in ai_links.
create table public.marketing_knowledge_sources (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 shortcode text not null check(shortcode ~ '^[A-Za-z0-9_-]{1,80}$'), canonical_url text not null,
 saved_at timestamptz, saved_at_status text not null check(saved_at_status in ('verified','unverified','unknown')),
 published_at timestamptz, imported_at timestamptz not null, cutoff timestamptz not null,
 content jsonb not null, provenance text not null, status text not null check(status in ('captured','partial','inaccessible','queued','analyzing','review','failed','cancelled')),
 analysis_key text, budget_usd numeric not null default 0 check(budget_usd between 0 and 1), run_id text, dataset_id text, analysis jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,shortcode),
 check(canonical_url='https://www.instagram.com/p/' || shortcode || '/'),
 check((saved_at_status='unknown' and saved_at is null) or (saved_at_status<>'unknown' and saved_at is not null)),
 check(analysis_key is null or analysis_key ~ '^[a-f0-9]{64}$')
);
create table public.marketing_knowledge_items (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 ai_link_id uuid not null references public.ai_links(id) on delete cascade,
 procedure_hash text not null check(procedure_hash ~ '^[a-f0-9]{64}$'), metadata jsonb not null,
 evidence jsonb not null default '[]', source_ids uuid[] not null default '{}',
 review_status text not null check(review_status in ('needs-review','reviewed','legacy-unverified')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,ai_link_id)
);
create index marketing_knowledge_procedure_idx on public.marketing_knowledge_items(user_id,procedure_hash);
create table public.marketing_knowledge_events (
 user_id uuid not null references auth.users(id) on delete cascade, event_id text not null,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(user_id,event_id)
);
alter table public.marketing_knowledge_sources enable row level security;
alter table public.marketing_knowledge_items enable row level security;
alter table public.marketing_knowledge_events enable row level security;
revoke all on public.marketing_knowledge_sources,public.marketing_knowledge_items,public.marketing_knowledge_events from anon,authenticated;
grant select on public.marketing_knowledge_sources,public.marketing_knowledge_items to authenticated;
grant all on public.marketing_knowledge_sources,public.marketing_knowledge_items,public.marketing_knowledge_events to service_role;
create policy marketing_knowledge_sources_own on public.marketing_knowledge_sources for select to authenticated using(user_id=(select auth.uid()));
create policy marketing_knowledge_items_own on public.marketing_knowledge_items for select to authenticated using(user_id=(select auth.uid()));

-- Privileged writers must also preserve ownership of every nested canonical reference.
create function public.marketing_knowledge_owner_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare ref jsonb; refid text; kind text;
begin
 if not exists(select 1 from public.ai_links where id=new.ai_link_id and user_id=new.user_id and record_type='idea') then raise exception 'foreign knowledge link'; end if;
 if exists(select 1 from unnest(new.source_ids) sid where not exists(select 1 from public.marketing_knowledge_sources s where s.id=sid and s.user_id=new.user_id)) then raise exception 'foreign knowledge source'; end if;
 ref:=new.metadata->'references';
 if jsonb_typeof(ref)<>'object' or ref is null or exists(select 1 from jsonb_object_keys(ref) k where k not in ('projectIds','noteIds','promptIds','toolIds')) then raise exception 'invalid knowledge references'; end if;
 foreach kind in array array['projectIds','noteIds','promptIds','toolIds'] loop
  if jsonb_typeof(ref->kind)<>'array' or ref->kind is null then raise exception 'invalid knowledge references'; end if;
  for refid in select jsonb_array_elements_text(ref->kind) loop
   if kind='projectIds' and not exists(select 1 from public.projects where id=refid::uuid and user_id=new.user_id) then raise exception 'foreign knowledge project'; end if;
   if kind='noteIds' and not exists(select 1 from public.notes where id=refid::uuid and user_id=new.user_id) then raise exception 'foreign knowledge note'; end if;
   if kind='promptIds' and not exists(select 1 from public.prompts where id=refid::uuid and user_id=new.user_id) then raise exception 'foreign knowledge prompt'; end if;
   if kind='toolIds' and not exists(select 1 from public.tools where id=refid::uuid and user_id=new.user_id) then raise exception 'foreign knowledge tool'; end if;
  end loop;
 end loop;
 return new;
end $$;
create trigger marketing_knowledge_items_owner before insert or update on public.marketing_knowledge_items for each row execute function public.marketing_knowledge_owner_guard();
revoke execute on function public.marketing_knowledge_owner_guard() from public,anon,authenticated;

create function public.marketing_import_knowledge(p_owner uuid,p_sources jsonb,p_items jsonb,p_event_id text) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare s jsonb; item jsonb; prior public.marketing_knowledge_events; existing public.marketing_knowledge_sources;
 sourceid uuid; linkid uuid; refs uuid[]; short text; sourceurl text; result jsonb; merged_evidence jsonb;
 sourceids jsonb:='[]'; linkids jsonb:='[]'; created_links int:=0; payload jsonb;
begin
 if p_owner is null then raise exception 'knowledge owner unavailable'; end if;
 if jsonb_typeof(p_sources)<>'array' or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_sources)>500 or jsonb_array_length(p_items)>1000 or length(p_event_id) not between 1 and 200 then raise exception 'invalid knowledge import'; end if;
 -- imported_at records the actual first import but is not request identity.
 payload:=jsonb_build_object('sources',(select coalesce(jsonb_agg(value-'imported_at'),'[]'::jsonb) from jsonb_array_elements(p_sources)),'items',p_items);
 if octet_length(payload::text)>2000000 then raise exception 'knowledge import too large'; end if;
 perform pg_advisory_xact_lock(hashtext(p_owner::text));
 select * into prior from public.marketing_knowledge_events where user_id=p_owner and event_id=p_event_id;
 if found then
  if prior.payload<>payload then raise exception 'knowledge event conflict'; end if;
  return prior.result || jsonb_build_object('duplicate',true);
 end if;
 for s in select value from jsonb_array_elements(p_sources) loop
  select * into existing from public.marketing_knowledge_sources where user_id=p_owner and shortcode=s->>'shortcode' for update;
  if found then
   -- Capture retries never reset a completed/queued analysis or its first cutoff.
   if s->>'status'='queued' and existing.analysis_key=s->>'analysis_key' then
    sourceids:=sourceids || to_jsonb(existing.id); continue;
   end if;
   if s->>'status'='queued' and existing.status in ('queued','analyzing') then raise exception 'knowledge analysis already pending'; end if;
   if existing.status in ('queued','analyzing','review') and s->>'status' in ('captured','partial') and
      not (p_event_id like 'callback:%' and existing.analysis_key=s->>'analysis_key' and existing.run_id=s->>'run_id') then
    sourceids:=sourceids || to_jsonb(existing.id); continue;
   end if;
  end if;
  insert into public.marketing_knowledge_sources(user_id,shortcode,canonical_url,saved_at,saved_at_status,published_at,imported_at,cutoff,content,provenance,status,analysis_key,budget_usd,run_id,dataset_id,analysis)
  values(p_owner,s->>'shortcode',s->>'canonical_url',(s->>'saved_at')::timestamptz,s->>'saved_at_status',(s->>'published_at')::timestamptz,(s->>'imported_at')::timestamptz,(s->>'cutoff')::timestamptz,s->'content',s->>'provenance',s->>'status',s->>'analysis_key',coalesce((s->>'budget_usd')::numeric,0),s->>'run_id',s->>'dataset_id',nullif(s->'analysis','null'::jsonb))
  on conflict(user_id,shortcode) do update set
   saved_at=case when excluded.saved_at_status='verified' then excluded.saved_at else marketing_knowledge_sources.saved_at end,
   saved_at_status=case when excluded.saved_at_status='verified' then 'verified' else marketing_knowledge_sources.saved_at_status end,
   published_at=coalesce(excluded.published_at,marketing_knowledge_sources.published_at),
   content=jsonb_build_object(
    'caption',coalesce(nullif(excluded.content->'caption','null'::jsonb),marketing_knowledge_sources.content->'caption'),
    'captionProvider',case when excluded.content->>'caption' is not null then excluded.content->'captionProvider' else marketing_knowledge_sources.content->'captionProvider' end,
    'transcript',case when excluded.content->'transcript'->>'status'='available' or marketing_knowledge_sources.content->'transcript'->>'status'<>'available' then excluded.content->'transcript' else marketing_knowledge_sources.content->'transcript' end,
    'ocr',case when excluded.content->'ocr'->>'status'='available' or marketing_knowledge_sources.content->'ocr'->>'status'<>'available' then excluded.content->'ocr' else marketing_knowledge_sources.content->'ocr' end),
   status=case when excluded.status='partial' and marketing_knowledge_sources.status='captured' then 'captured' else excluded.status end,analysis_key=coalesce(excluded.analysis_key,marketing_knowledge_sources.analysis_key),
   budget_usd=excluded.budget_usd,run_id=coalesce(excluded.run_id,marketing_knowledge_sources.run_id),dataset_id=coalesce(excluded.dataset_id,marketing_knowledge_sources.dataset_id),analysis=coalesce(excluded.analysis,marketing_knowledge_sources.analysis),updated_at=now()
  returning id into sourceid;
  sourceids:=sourceids || to_jsonb(sourceid);
 end loop;
 for item in select value from jsonb_array_elements(p_items) loop
  if exists(select 1 from jsonb_object_keys(item) k where k not in ('title','summary','steps','category','tipGroup','tags','evidence','missingParts','contraryClaims','aiLinkId','procedureHash','sourceShortcodes','references','evidenceStatus')) then raise exception 'invalid knowledge item fields'; end if;
  refs:='{}'; sourceurl:=null;
  for short in select jsonb_array_elements_text(item->'sourceShortcodes') loop
   select id,canonical_url into sourceid,sourceurl from public.marketing_knowledge_sources where user_id=p_owner and shortcode=short;
   if not found then raise exception 'knowledge source unavailable'; end if;
   refs:=array_append(refs,sourceid);
  end loop;
  linkid:=(item->>'aiLinkId')::uuid;
  if linkid is not null then
   if not exists(select 1 from public.ai_links where id=linkid and user_id=p_owner and record_type='idea') then raise exception 'foreign knowledge link'; end if;
  else
   select ai_link_id into linkid from public.marketing_knowledge_items where user_id=p_owner and procedure_hash=item->>'procedureHash' order by created_at,id limit 1;
   if not found then
    if sourceurl is null then raise exception 'knowledge source required'; end if;
    insert into public.ai_links(user_id,record_type,title,url,description,tip_group,tip_summary,source_urls)
    values(p_owner,'idea',item->>'title',sourceurl,array_to_string(array(select jsonb_array_elements_text(item->'steps')),E'\n'),item->>'tipGroup',item->>'summary',array(select canonical_url from public.marketing_knowledge_sources where id=any(refs) and user_id=p_owner)) returning id into linkid;
    created_links:=created_links+1;
   end if;
  end if;
  if exists(select 1 from public.marketing_knowledge_items where user_id=p_owner and ai_link_id=linkid and procedure_hash<>item->>'procedureHash') then raise exception 'knowledge procedure changed; review required'; end if;
  merged_evidence:=item->'evidence';
  insert into public.marketing_knowledge_items(user_id,ai_link_id,procedure_hash,metadata,evidence,source_ids,review_status)
  values(p_owner,linkid,item->>'procedureHash',item-'aiLinkId'-'procedureHash'-'evidence',merged_evidence,refs,item->>'evidenceStatus')
  on conflict(user_id,ai_link_id) do update set
   evidence=(select coalesce(jsonb_agg(distinct e),'[]'::jsonb) from jsonb_array_elements(marketing_knowledge_items.evidence || excluded.evidence) e),
   source_ids=array(select distinct sid from unnest(marketing_knowledge_items.source_ids || excluded.source_ids) sid),updated_at=now();
  -- Source joins extend the canonical tip's evidence URLs without changing its ID/text/project associations.
  update public.ai_links set source_urls=array(select distinct u from unnest(coalesce(source_urls,'{}') || array(select canonical_url from public.marketing_knowledge_sources where id=any(refs) and user_id=p_owner)) u) where id=linkid and user_id=p_owner;
  linkids:=linkids || to_jsonb(linkid);
 end loop;
 result:=jsonb_build_object('sourceIds',sourceids,'knowledgeIds',linkids,'createdItems',created_links,'duplicate',false);
 insert into public.marketing_knowledge_events values(p_owner,p_event_id,payload,result,now());
 return result;
end $$;
revoke execute on function public.marketing_import_knowledge(uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_import_knowledge(uuid,jsonb,jsonb,text) to service_role;
