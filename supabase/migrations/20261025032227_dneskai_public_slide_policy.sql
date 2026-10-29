-- Public DNESKAi content policy. Existing revisions/approvals remain intact; unsupported legacy decks cannot
-- gain approval or a new publication claim. An owner edit creates a new revision and requires its own approval.
set lock_timeout='5s';
create function marketing_private.dneskai_deck_content_blocks(p_revision jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare slide jsonb; ordinal bigint; field text; allowed text[];
 whitespace constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 if p_revision->>'brand' is distinct from 'dneskai' or not (p_revision ? 'deck') then return false; end if;
 if jsonb_typeof(p_revision->'deck') is distinct from 'object'
  or jsonb_typeof(p_revision->'deck'->'slides') is distinct from 'array' then return true; end if;
 if jsonb_array_length(p_revision->'deck'->'slides') not between 1 and 10 then return true; end if;
 for slide,ordinal in select value, ordinality from jsonb_array_elements(p_revision->'deck'->'slides') with ordinality loop
  if jsonb_typeof(slide) is distinct from 'object' or slide->>'type' is null
   or slide->>'type' not in ('cover-photo','figure','split','statement','single') then return true; end if;
  allowed:=case when ordinal=1 or slide->>'type' in ('cover-photo','single') then array['headline']
    when slide->>'type'='split' then array['headline','body','kicker'] else array['headline','body'] end;
  foreach field in array array['headline','body','kicker','credit'] loop
   if slide ? field then
    if jsonb_typeof(slide->field) is distinct from 'string' then return true; end if;
    if not (field=any(allowed)) and btrim(slide->>field,whitespace)<>'' then return true; end if;
   end if;
  end loop;
  if slide ? 'sources' then
   if jsonb_typeof(slide->'sources') is distinct from 'array' then return true; end if;
   if exists(select 1 from jsonb_array_elements(slide->'sources') line where jsonb_typeof(line) is distinct from 'string' or btrim(line#>>'{}',whitespace)<>'') then return true; end if;
  end if;
 end loop;
 return false;
end $$;
revoke all on function marketing_private.dneskai_deck_content_blocks(jsonb) from public,anon,authenticated;
grant execute on function marketing_private.dneskai_deck_content_blocks(jsonb) to service_role;

create or replace function public.marketing_approve_revision(p_revision_id uuid,p_expected_hash text)
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
 if marketing_private.dneskai_deck_content_blocks(r.revision) or marketing_private.render_report_blocks(r.render_report) then raise exception 'render blocked'; end if;
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
 if r.status<>'approved' then insert into public.marketing_events(user_id,revision_id,kind,payload) values(r.user_id,r.id,'approved',jsonb_build_object('publicationId',publication)); end if;
 return publication;
end $$;
revoke all on function public.marketing_approve_revision(uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_approve_revision(uuid,text) to authenticated;

create or replace function public.marketing_claim_due(p_owner uuid,p_limit integer default 10,p_brand text default null,p_publication uuid default null)
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
   and not marketing_private.dneskai_deck_content_blocks(r.revision)
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
reset lock_timeout;
