-- Offline imports consume no paid generation jobs and grant no approval authority.
alter table public.marketing_revisions add column offline_import_receipt jsonb;
create table public.marketing_offline_imports (
 user_id uuid not null references auth.users(id) on delete cascade,
 calendar_entry_id uuid not null references public.marketing_calendar_entries(id) on delete cascade,
 generation_version integer not null check(generation_version>0),
 revision_id uuid not null references public.marketing_revisions(id),
 identity_hash text not null check(identity_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 primary key(user_id,calendar_entry_id,generation_version)
);
alter table public.marketing_offline_imports enable row level security;
revoke all on public.marketing_offline_imports from public,anon,authenticated;
grant select on public.marketing_offline_imports to authenticated;
grant all on public.marketing_offline_imports to service_role;
create policy owner_read on public.marketing_offline_imports for select to authenticated using ((select auth.uid())=user_id);
create function public.marketing_check_offline_import_owner() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.marketing_calendar_entries e join public.marketing_revisions r on r.id=new.revision_id where e.id=new.calendar_entry_id and e.user_id=new.user_id and r.user_id=new.user_id and r.calendar_entry_id=e.id) then raise exception 'foreign offline import'; end if;
 return new;
end $$;
revoke all on function public.marketing_check_offline_import_owner() from public,anon,authenticated;
create trigger marketing_ownership before insert or update on public.marketing_offline_imports for each row execute function public.marketing_check_offline_import_owner();

-- The normal caption/schedule edit path inherits this hold. It cannot approve an unreviewed layout.
create function public.marketing_guard_offline_review() returns trigger language plpgsql set search_path='' as $$
declare inherited jsonb;
begin
 if tg_op='UPDATE' and old.offline_import_receipt is not null then
  if new.offline_import_receipt is distinct from old.offline_import_receipt then raise exception 'offline receipt immutable'; end if;
 end if;
 if new.replaces_id is not null then
  select offline_import_receipt into inherited from public.marketing_revisions where id=new.replaces_id and user_id=new.user_id;
  if inherited is not null then new.offline_import_receipt:=inherited; end if;
 end if;
 if new.offline_import_receipt is not null then
  if new.offline_import_receipt->>'schemaVersion' is distinct from 'marketing-offline-import/1' or new.offline_import_receipt->>'holdCode' is distinct from 'offline-import-review-required' then raise exception 'invalid offline receipt'; end if;
  new.ready:=false;
  if new.status in ('approved','publishing','published','reconciliation') or new.approved_at is not null or new.approved_hash is not null then raise exception 'offline review required'; end if;
 end if;
 return new;
end $$;
revoke all on function public.marketing_guard_offline_review() from public,anon,authenticated;
create trigger marketing_offline_review before insert or update on public.marketing_revisions for each row execute function public.marketing_guard_offline_review();

-- Verify the existing immutable database window before any Storage/source writes.
create function public.marketing_check_offline_import_scope(p_owner uuid,p_pilot jsonb)
returns boolean language plpgsql set search_path='' as $$
begin
 if p_pilot is null then raise exception 'active pilot required'; end if;
 return marketing_private.check_generation_pilot(p_owner,p_pilot,false);
end $$;
revoke all on function public.marketing_check_offline_import_scope(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_check_offline_import_scope(uuid,jsonb) to service_role;

create function public.marketing_import_offline_revision(p_owner uuid,p_id uuid,p_campaign uuid,p_entry uuid,p_version integer,p_role text,p_identity text,p_revision jsonb,p_hash text,p_receipt jsonb,p_pilot jsonb)
returns uuid language plpgsql set search_path='' as $$
declare e public.marketing_calendar_entries; c public.marketing_campaigns; prior public.marketing_offline_imports; expected_slot text; expected_format text;
begin
 if p_pilot is null or not marketing_private.check_generation_pilot(p_owner,p_pilot,false) then raise exception 'active pilot required'; end if;
 expected_slot:=case p_role when 'carousel' then 'ig' when 'thread-question' then 'threads-question' when 'thread-answer' then 'threads-answer' when 'story-question' then 'story-1' when 'story-options' then 'story-2' when 'story-answer' then 'story-3' end;
 expected_format:=case when p_role='carousel' then 'carousel' when p_role like 'thread-%' then 'thread' when p_role like 'story-%' then 'story' end;
 if p_revision->>'schemaVersion' is distinct from 'marketing-content/1' or p_revision->>'model' is distinct from 'none-offline-authored' or p_revision->>'promptVersion' is distinct from 'authored-weekly-offline-import/1' or p_revision->>'timeZone' is distinct from 'Europe/Prague' or jsonb_typeof(p_revision->'scheduledAt') is distinct from 'string' or (p_revision->>'traceId') is not null then raise exception 'invalid offline revision'; end if;
 if expected_slot is null or p_identity is null or p_hash is null or p_identity !~ '^[a-f0-9]{64}$' or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid import'; end if;
 select * into e from public.marketing_calendar_entries where id=p_entry and user_id=p_owner and campaign_id=p_campaign for update;
 if not found or e.generation_version<>p_version or e.status not in ('planned','blocked') then raise exception 'entry unavailable'; end if;
 select * into c from public.marketing_campaigns where id=p_campaign and user_id=p_owner for share;
 if not found or c.brand<>'devshark' or c.status='archived' or c.time_zone<>'Europe/Prague' then raise exception 'campaign unavailable'; end if;
 if not marketing_private.check_generation_pilot(p_owner,p_pilot,false) then raise exception 'active pilot required'; end if;
 if jsonb_array_length(p_revision->'sources') is distinct from 1 or p_revision->>'brand' is distinct from 'devshark' or p_revision->>'format' is distinct from expected_format or e.kind<>expected_format or e.platform<>p_revision->'account'->>'platform'
   or e.original->>'slot' is distinct from expected_slot or e.original->>'sourceId' is distinct from p_revision->'sources'->0->>'sourceId'
   or e.original->>'sourceRevision' is distinct from p_revision->'sources'->0->>'sourceRevision' or e.original->>'contentHash' is distinct from p_revision->'sources'->0->>'contentHash'
   or (p_revision->>'scheduledAt')::timestamptz<=now() or ((p_revision->>'scheduledAt')::timestamptz at time zone 'Europe/Prague')::date<>e.date
   or to_char((p_revision->>'scheduledAt')::timestamptz at time zone 'Europe/Prague','HH24:MI') is distinct from e.local_time then raise exception 'entry binding mismatch'; end if;
 if not public.marketing_sources_valid(p_owner,'devshark',p_revision,now(),true) then raise exception 'source unavailable'; end if;
 if e.bound_source_id is not null and not exists(select 1 from public.marketing_sources where id=e.bound_source_id and user_id=p_owner and source_id=p_revision->'sources'->0->>'sourceId' and brand='devshark') then raise exception 'source binding mismatch'; end if;
 if not exists(select 1 from public.marketing_accounts where user_id=p_owner and brand='devshark' and platform=e.platform and remote_account_id=p_revision->'account'->>'id' and handle=p_revision->'account'->>'handle' and verified_at is not null) then raise exception 'account unavailable'; end if;
 if p_receipt->>'identityHash' is distinct from p_identity or p_receipt->>'role' is distinct from p_role or p_receipt->>'schemaVersion' is distinct from 'marketing-offline-import/1' or p_receipt->>'holdCode' is distinct from 'offline-import-review-required' or p_receipt->>'templateApproved' is distinct from 'false' or p_receipt->>'sourceContentHash' is distinct from p_revision->'sources'->0->>'contentHash' or p_receipt->>'providerCalls' is distinct from '0' or jsonb_typeof(p_receipt->'assetHashes') is distinct from 'array' or p_receipt->'assetHashes' is distinct from (select coalesce(jsonb_agg(asset->'sha256'),'[]'::jsonb) from jsonb_array_elements(p_revision->'assets') asset) then raise exception 'receipt mismatch'; end if;
 select * into prior from public.marketing_offline_imports where user_id=p_owner and calendar_entry_id=p_entry and generation_version=p_version;
 if found then if prior.identity_hash<>p_identity then raise exception 'import conflict'; end if; return prior.revision_id; end if;
 if exists(select 1 from public.marketing_revisions where user_id=p_owner and calendar_entry_id=p_entry and status not in ('superseded','skipped')) then raise exception 'entry already has revision'; end if;
 -- Row locks or account/source checks must not carry a reservation past its fixed window.
 if not marketing_private.check_generation_pilot(p_owner,p_pilot,false) then raise exception 'active pilot required'; end if;
 insert into public.marketing_revisions(id,user_id,project_id,campaign_id,calendar_entry_id,brand,revision,slides,content_hash,ready,offline_import_receipt)
 values(p_id,p_owner,c.project_id,p_campaign,p_entry,'devshark',p_revision,'[]',p_hash,false,p_receipt);
 insert into public.marketing_offline_imports(user_id,calendar_entry_id,generation_version,revision_id,identity_hash) values(p_owner,p_entry,p_version,p_id,p_identity);
 insert into public.marketing_events(user_id,revision_id,kind,payload) values(p_owner,p_id,'offline-imported',jsonb_build_object('holdCode','offline-import-review-required','role',p_role,'manifestSha256',p_receipt->>'manifestSha256','providerCalls',0));
 return p_id;
end $$;
revoke all on function public.marketing_import_offline_revision(uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_import_offline_revision(uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb,jsonb) to service_role;
