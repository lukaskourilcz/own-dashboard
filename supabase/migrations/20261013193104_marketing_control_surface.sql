-- Owner-scoped marketing state. Production rollout requires review and a backup.
create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id), brand text not null check (brand in ('dneskai','devshark')),
  name text not null, starts_on date not null, ends_on date not null, time_zone text not null default 'Europe/Prague',
  source_snapshot jsonb not null, source_hash text not null, status text not null default 'draft' check(status in ('draft','active','archived')),
  created_at timestamptz not null default now(), unique(user_id,brand,source_hash,starts_on), check(ends_on >= starts_on)
);
create table public.marketing_calendar_entries (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  source_id text not null, date date not null, local_time text, kind text not null, platform text not null,
  title text not null, original jsonb not null, knowledge_ids uuid[] not null default '{}',
  status text not null default 'planned', needs_review boolean not null default false, generation_version integer not null default 1,
  unique(campaign_id,source_id)
);
create table public.marketing_sources (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id), brand text not null check(brand in ('dneskai','devshark')),
  source_id text not null, source_revision text not null, content_hash text not null,
  packet jsonb not null, observed_at timestamptz not null, expires_at timestamptz, eligible boolean not null,
  created_at timestamptz not null default now(), unique(user_id,brand,source_id)
);
create table public.marketing_source_history (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null references public.marketing_sources(id) on delete cascade,
  source_revision text not null, packet jsonb not null, recorded_at timestamptz not null default now(),
  unique(source_id,source_revision)
);
alter table public.marketing_calendar_entries add column bound_source_id uuid references public.marketing_sources(id);
create table public.marketing_accounts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  brand text not null check(brand in ('dneskai','devshark')), platform text not null check(platform in ('instagram','threads')),
  remote_account_id text not null, handle text not null, verified_at timestamptz,
  enabled boolean not null default false, unique(user_id,brand,platform)
);
create table public.marketing_revisions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id), campaign_id uuid references public.marketing_campaigns(id),
  calendar_entry_id uuid references public.marketing_calendar_entries(id),
  replaces_id uuid references public.marketing_revisions(id), brand text not null check(brand in ('dneskai','devshark')),
  revision jsonb not null, slides jsonb not null default '[]', content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  ready boolean not null default false,
  status text not null default 'review' check(status in ('review','approved','publishing','published','failed','reconciliation','returned','skipped','superseded')),
  approved_at timestamptz, approved_hash text, feedback text, created_at timestamptz not null default now()
);
create table public.marketing_publications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  revision_id uuid not null references public.marketing_revisions(id), platform text not null check(platform in ('instagram','threads')),
  status text not null default 'queued' check(status in ('queued','claimed','published','failed','reconciliation','cancelled')),
  scheduled_at timestamptz not null, lease_until timestamptz, attempts integer not null default 0,
  remote_container_id text, remote_media_id text, remote_url text, error_code text, last_checked_at timestamptz,
  created_at timestamptz not null default now(), unique(revision_id,platform)
);
create table public.marketing_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  revision_id uuid references public.marketing_revisions(id), kind text not null, payload jsonb not null default '{}',
  delivered_at timestamptz, created_at timestamptz not null default now()
);
create index marketing_revisions_owner_status on public.marketing_revisions(user_id,status,created_at desc);
create index marketing_revisions_calendar_entry on public.marketing_revisions(user_id,calendar_entry_id) where calendar_entry_id is not null;
create index marketing_sources_owner on public.marketing_sources(user_id,brand);
create index marketing_due on public.marketing_publications(scheduled_at) where status='queued';
create index marketing_calendar_owner_date on public.marketing_calendar_entries(user_id,date);
create index marketing_events_pending on public.marketing_events(user_id,created_at) where delivered_at is null;

-- Child ownership is checked even for service-role writes.
create function public.marketing_check_ownership() returns trigger language plpgsql set search_path='' as $$
begin
  if to_jsonb(new) ? 'project_id' and (to_jsonb(new)->>'project_id') is not null and not exists(
    select 1 from public.projects where id=(to_jsonb(new)->>'project_id')::uuid and user_id=new.user_id
  ) then raise exception 'foreign project'; end if;
  if to_jsonb(new) ? 'campaign_id' and (to_jsonb(new)->>'campaign_id') is not null and not exists(
    select 1 from public.marketing_campaigns where id=(to_jsonb(new)->>'campaign_id')::uuid and user_id=new.user_id
  ) then raise exception 'foreign campaign'; end if;
  if to_jsonb(new) ? 'revision_id' and (to_jsonb(new)->>'revision_id') is not null and not exists(
    select 1 from public.marketing_revisions where id=(to_jsonb(new)->>'revision_id')::uuid and user_id=new.user_id
  ) then raise exception 'foreign revision'; end if;
  if to_jsonb(new) ? 'source_id' and tg_table_name='marketing_source_history' and not exists(
    select 1 from public.marketing_sources where id=(to_jsonb(new)->>'source_id')::uuid and user_id=new.user_id
  ) then raise exception 'foreign source'; end if;
  if tg_table_name='marketing_revisions' and (to_jsonb(new)->>'replaces_id') is not null and not exists(
    select 1 from public.marketing_revisions where id=(to_jsonb(new)->>'replaces_id')::uuid and user_id=new.user_id and brand=to_jsonb(new)->>'brand'
  ) then raise exception 'foreign replacement'; end if;
  if tg_table_name='marketing_revisions' and (to_jsonb(new)->>'calendar_entry_id') is not null and not exists(
    select 1 from public.marketing_calendar_entries e join public.marketing_campaigns c on c.id=e.campaign_id
    where e.id=(to_jsonb(new)->>'calendar_entry_id')::uuid and e.user_id=new.user_id and c.user_id=new.user_id
      and c.brand=to_jsonb(new)->>'brand' and e.campaign_id=(to_jsonb(new)->>'campaign_id')::uuid
  ) then raise exception 'foreign calendar entry'; end if;
  if tg_table_name='marketing_calendar_entries' and exists (
    select 1 from jsonb_array_elements_text(to_jsonb(new)->'knowledge_ids') k
    where not exists(select 1 from public.ai_links a where a.id=k::uuid and a.user_id=new.user_id)
  ) then raise exception 'foreign knowledge'; end if;
  if tg_table_name='marketing_calendar_entries' and (to_jsonb(new)->>'bound_source_id') is not null and not exists(
   select 1 from public.marketing_sources s join public.marketing_campaigns c on c.id=(to_jsonb(new)->>'campaign_id')::uuid
   where s.id=(to_jsonb(new)->>'bound_source_id')::uuid and s.user_id=new.user_id and s.brand=c.brand
  ) then raise exception 'foreign bound source'; end if;
  if tg_table_name='marketing_revisions' and exists (
    select 1 from jsonb_array_elements_text(to_jsonb(new)->'revision'->'knowledgeIds') k
    where not exists(select 1 from public.ai_links a where a.id=k::uuid and a.user_id=new.user_id)
  ) then raise exception 'foreign knowledge'; end if;
  return new;
end $$;
revoke all on function public.marketing_check_ownership() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['marketing_campaigns','marketing_calendar_entries','marketing_sources','marketing_source_history','marketing_accounts','marketing_revisions','marketing_publications','marketing_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid()) = user_id)',t);
    execute format('create trigger marketing_ownership before insert or update on public.%I for each row execute function public.marketing_check_ownership()',t);
  end loop;
end $$;

create function public.marketing_sources_valid(p_owner uuid,p_brand text,p_revision jsonb,p_now timestamptz,p_fresh boolean default false)
returns boolean language sql stable set search_path='' as $$
 select jsonb_array_length(p_revision->'sources') > 0 and not exists(
   select 1 from jsonb_array_elements(p_revision->'sources') ref where not exists(
     select 1 from public.marketing_sources s where s.user_id=p_owner and s.brand=p_brand
       and s.source_id=ref->>'sourceId' and s.source_revision=ref->>'sourceRevision'
       and s.content_hash=ref->>'contentHash' and s.eligible
       and (s.expires_at is null or s.expires_at>p_now)
       and (not p_fresh or s.observed_at>=p_now-interval '15 minutes')
   )
 );
$$;
revoke all on function public.marketing_sources_valid(uuid,text,jsonb,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.marketing_sources_valid(uuid,text,jsonb,timestamptz,boolean) to authenticated,service_role;

-- Authenticated users cannot UPDATE tables directly. This bounded function is
-- the only owner approval path; privileged work is guarded by auth.uid().
-- Campaign-only archival deliberately leaves remote receipts intact. New
-- approvals and remote write intents lock/check its current owned active state.
create function public.marketing_revision_campaign_active(p_owner uuid,p_campaign uuid,p_entry uuid default null)
returns boolean language plpgsql set search_path='' as $$
declare c public.marketing_campaigns; e public.marketing_calendar_entries;
begin
 if p_entry is not null then
  select * into e from public.marketing_calendar_entries where id=p_entry and user_id=p_owner for update;
  if not found or e.campaign_id is distinct from p_campaign or e.status<>'planned' or e.needs_review then return false; end if;
 end if;
 if p_campaign is null then return true; end if;
 select * into c from public.marketing_campaigns where id=p_campaign and user_id=p_owner for share;
 return found and c.status='active';
end $$;
revoke all on function public.marketing_revision_campaign_active(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_revision_campaign_active(uuid,uuid,uuid) to service_role;

create function public.marketing_approve_revision(p_revision_id uuid,p_expected_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.marketing_revisions; publication uuid; expected_campaign uuid; expected_entry uuid;
begin
 select * into r from public.marketing_revisions where id=p_revision_id and user_id=(select auth.uid());
 if not found then raise exception 'revision unavailable'; end if;
 expected_campaign:=r.campaign_id;
 expected_entry:=r.calendar_entry_id;
 if not public.marketing_revision_campaign_active(r.user_id,expected_campaign,expected_entry) then raise exception 'campaign inactive'; end if;
 select * into r from public.marketing_revisions where id=p_revision_id and user_id=(select auth.uid()) for update;
 if not found then raise exception 'revision unavailable'; end if;
 if r.campaign_id is distinct from expected_campaign or r.calendar_entry_id is distinct from expected_entry then raise exception 'revision changed'; end if;
 if r.content_hash<>p_expected_hash then raise exception 'revision changed'; end if;
 if r.status not in ('review','approved') or not r.ready then raise exception 'revision not ready'; end if;
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
 if r.status<>'approved' then insert into public.marketing_events(user_id,revision_id,kind,payload) values(r.user_id,r.id,'approved',jsonb_build_object('publicationId',publication)); end if;
 return publication;
end $$;
revoke all on function public.marketing_approve_revision(uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_approve_revision(uuid,text) to authenticated;

create function public.marketing_decide_revision(p_revision_id uuid,p_action text,p_feedback text default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.marketing_revisions;
begin
 if p_action not in ('returned','skipped') then raise exception 'invalid decision'; end if;
 select * into r from public.marketing_revisions where id=p_revision_id and user_id=(select auth.uid()) for update;
 if not found or r.status not in ('review','approved','returned','failed') or exists(
  select 1 from public.marketing_publications where revision_id=r.id and status in ('claimed','published','reconciliation')
 ) then raise exception 'revision unavailable'; end if;
 update public.marketing_revisions set status=p_action,approved_at=null,approved_hash=null,feedback=left(p_feedback,2000) where id=r.id;
 update public.marketing_publications set status='cancelled' where revision_id=r.id and status='queued';
 insert into public.marketing_events(user_id,revision_id,kind,payload) values(r.user_id,r.id,p_action,jsonb_build_object('feedback',left(p_feedback,2000)));
end $$;
revoke all on function public.marketing_decide_revision(uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketing_decide_revision(uuid,text,text) to authenticated;

-- Idempotent current-head ingest; a newer source invalidates unposted drafts.
create function public.marketing_ingest_source(p_owner uuid,p_packet jsonb)
returns uuid language plpgsql set search_path='' as $$
declare s public.marketing_sources; source_uuid uuid; invalidated uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text || (p_packet->>'brand') || (p_packet->>'sourceId'),0));
 select * into s from public.marketing_sources where user_id=p_owner and brand=p_packet->>'brand' and source_id=p_packet->>'sourceId' for update;
 if found and s.observed_at>(p_packet->>'observedAt')::timestamptz then return s.id; end if;
 if found and s.source_revision=p_packet->>'sourceRevision' and s.content_hash<>p_packet->>'contentHash' then raise exception 'revision hash conflict'; end if;
 insert into public.marketing_sources(user_id,brand,source_id,source_revision,content_hash,packet,observed_at,expires_at,eligible)
 values(p_owner,p_packet->>'brand',p_packet->>'sourceId',p_packet->>'sourceRevision',p_packet->>'contentHash',p_packet,(p_packet->>'observedAt')::timestamptz,(p_packet->>'expiresAt')::timestamptz,(p_packet->>'eligible')::boolean)
 on conflict(user_id,brand,source_id) do update set source_revision=excluded.source_revision,content_hash=excluded.content_hash,packet=excluded.packet,observed_at=excluded.observed_at,expires_at=excluded.expires_at,eligible=excluded.eligible returning id into source_uuid;
 insert into public.marketing_source_history(user_id,source_id,source_revision,packet) values(p_owner,source_uuid,p_packet->>'sourceRevision',p_packet) on conflict(source_id,source_revision) do nothing;
 for invalidated in select r.id from public.marketing_revisions r where r.user_id=p_owner and r.brand=p_packet->>'brand' and r.status in ('review','approved','returned','failed') and exists(
   select 1 from jsonb_array_elements(r.revision->'sources') ref where ref->>'sourceId'=p_packet->>'sourceId'
   and (ref->>'sourceRevision'<>p_packet->>'sourceRevision' or ref->>'contentHash'<>p_packet->>'contentHash' or not (p_packet->>'eligible')::boolean)
 ) loop
   update public.marketing_revisions set status='superseded',approved_hash=null,approved_at=null where id=invalidated;
   update public.marketing_publications set status='cancelled' where revision_id=invalidated and status='queued';
 end loop;
 return source_uuid;
end $$;
revoke all on function public.marketing_ingest_source(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_ingest_source(uuid,jsonb) to service_role;

create function public.marketing_claim_due(p_owner uuid,p_limit integer default 10,p_brand text default null,p_publication uuid default null)
returns setof public.marketing_publications language plpgsql set search_path='' as $$
begin
 -- An expired lease is ambiguous, not permission to send again.
 update public.marketing_publications set status='reconciliation',error_code='lease-expired' where user_id=p_owner and status='claimed' and lease_until<now();
 update public.marketing_revisions r set status='reconciliation' where r.user_id=p_owner and r.status='publishing' and exists(select 1 from public.marketing_publications p where p.revision_id=r.id and p.status='reconciliation');
 update public.marketing_revisions r set status='failed',approved_at=null,approved_hash=null where r.user_id=p_owner and r.status='approved' and exists(select 1 from public.marketing_publications p where p.revision_id=r.id and p.status='queued' and p.scheduled_at<now()-interval '15 minutes');
 update public.marketing_publications set status='failed',error_code='publish-window-expired' where user_id=p_owner and status='queued' and scheduled_at<now()-interval '15 minutes';
 return query with candidates as (
   select p.id from public.marketing_publications p join public.marketing_revisions r on r.id=p.revision_id
   where p.user_id=p_owner and (p_publication is null or p.id=p_publication) and (p_brand is null or r.brand=p_brand) and p.status='queued' and p.scheduled_at<=now() and p.scheduled_at>=now()-interval '15 minutes'
   and r.status='approved' and r.approved_hash=r.content_hash and r.ready
   and public.marketing_revision_campaign_active(p_owner,r.campaign_id,r.calendar_entry_id)
   and p.scheduled_at=(r.revision->>'scheduledAt')::timestamptz
   and public.marketing_sources_valid(p_owner,r.brand,r.revision,now(),true)
   and exists(select 1 from public.marketing_accounts a where a.user_id=p_owner and a.brand=r.brand and a.platform=p.platform
     and a.remote_account_id=r.revision->'account'->>'id' and a.enabled and a.verified_at is not null)
   order by p.scheduled_at for update of p skip locked limit least(greatest(p_limit,1),20)
 ), claimed as (
   update public.marketing_publications p set status='claimed',lease_until=now()+interval '10 minutes',attempts=attempts+1
   where p.id in (select id from candidates) returning p.*
 ) select * from claimed;
end $$;
revoke all on function public.marketing_claim_due(uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.marketing_claim_due(uuid,integer,text,uuid) to service_role;

create function public.marketing_save_revision(p_owner uuid,p_id uuid,p_revision jsonb,p_hash text,p_ready boolean,p_slides jsonb,p_replace uuid default null)
returns uuid language plpgsql set search_path='' as $$
declare existing public.marketing_revisions; previous public.marketing_revisions; inherited_entry uuid; expected_campaign uuid; legacy_entries uuid[];
begin
 if not public.marketing_sources_valid(p_owner,p_revision->>'brand',p_revision,now(),false) then raise exception 'source changed'; end if;
 select * into existing from public.marketing_revisions where id=p_id for update;
 if found then
  if existing.user_id<>p_owner or existing.content_hash<>p_hash then raise exception 'revision identity conflict'; end if;
  return existing.id;
 end if;
 if p_replace is not null then
  select * into previous from public.marketing_revisions where id=p_replace and user_id=p_owner and brand=p_revision->>'brand';
  if not found then raise exception 'replacement unavailable'; end if;
  expected_campaign:=previous.campaign_id;
  inherited_entry:=previous.calendar_entry_id;
  -- Legacy worker rows have a job association but no direct revision lineage.
  if inherited_entry is null then
   select array_agg(distinct e.id) into legacy_entries from public.marketing_jobs j join public.marketing_calendar_entries e on e.id::text=j.request->>'calendarEntryId'
    where j.user_id=p_owner and j.request->'generation'->>'revisionId'=p_replace::text and e.user_id=p_owner and e.campaign_id=expected_campaign;
   if cardinality(legacy_entries)>1 then raise exception 'replacement lineage ambiguous'; end if;
   inherited_entry:=legacy_entries[1];
  end if;
  if inherited_entry is not null then
   perform 1 from public.marketing_calendar_entries where id=inherited_entry and user_id=p_owner and campaign_id=expected_campaign for update;
   if not found then raise exception 'replacement lineage unavailable'; end if;
  end if;
  if expected_campaign is not null then
   perform 1 from public.marketing_campaigns where id=expected_campaign and user_id=p_owner for share;
   if not found then raise exception 'replacement lineage unavailable'; end if;
  end if;
  select * into previous from public.marketing_revisions where id=p_replace and user_id=p_owner and brand=p_revision->>'brand' for update;
  if not found or previous.status in ('publishing','published','reconciliation','superseded') or exists(select 1 from public.marketing_publications where revision_id=p_replace and status in ('claimed','published','reconciliation')) then raise exception 'replacement unavailable'; end if;
  if previous.campaign_id is distinct from expected_campaign or (previous.calendar_entry_id is not null and previous.calendar_entry_id is distinct from inherited_entry) then raise exception 'replacement lineage changed'; end if;
  update public.marketing_revisions set status='superseded',approved_at=null,approved_hash=null where id=p_replace;
  update public.marketing_publications set status='cancelled' where revision_id=p_replace and status='queued';
 end if;
 insert into public.marketing_revisions(id,user_id,project_id,campaign_id,calendar_entry_id,brand,revision,slides,content_hash,ready,replaces_id)
 values(p_id,p_owner,previous.project_id,previous.campaign_id,inherited_entry,p_revision->>'brand',p_revision,p_slides,p_hash,p_ready,p_replace);
 return p_id;
end $$;
revoke all on function public.marketing_save_revision(uuid,uuid,jsonb,text,boolean,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.marketing_save_revision(uuid,uuid,jsonb,text,boolean,jsonb,uuid) to service_role;

create function public.marketing_import_campaign(p_owner uuid,p_campaign jsonb,p_entries jsonb)
returns uuid language plpgsql set search_path='' as $$
declare campaign_uuid uuid; entry jsonb;
begin
 insert into public.marketing_campaigns(user_id,brand,name,starts_on,ends_on,time_zone,source_snapshot,source_hash)
 values(p_owner,p_campaign->>'brand',p_campaign->>'name',(p_campaign->>'starts_on')::date,(p_campaign->>'ends_on')::date,p_campaign->>'time_zone',p_campaign->'source_snapshot',p_campaign->>'source_hash')
 on conflict(user_id,brand,source_hash,starts_on) do update set name=excluded.name returning id into campaign_uuid;
 for entry in select value from jsonb_array_elements(p_entries) loop
  insert into public.marketing_calendar_entries(user_id,campaign_id,source_id,date,local_time,kind,platform,title,original,knowledge_ids,status,needs_review)
  values(p_owner,campaign_uuid,entry->>'source_id',(entry->>'date')::date,entry->>'local_time',entry->>'kind',entry->>'platform',entry->>'title',entry->'original',array(select jsonb_array_elements_text(entry->'knowledge_ids'))::uuid[],entry->>'status',(entry->>'needs_review')::boolean)
  on conflict(campaign_id,source_id) do nothing;
 end loop;
 return campaign_uuid;
end $$;
revoke all on function public.marketing_import_campaign(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_import_campaign(uuid,jsonb,jsonb) to service_role;
