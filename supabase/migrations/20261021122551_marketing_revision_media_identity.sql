-- #118: an approval belongs to exact bytes and crops, not to delivery links.
-- content_hash is computed by the server as sha256 over the canonical revision
-- without assets[].url (revisionContentHash). SQL never computes it; it only
-- compares stored values, so the existing save/claim functions stay as they are.

-- The last deck render of a DNESKAi revision. Null for legacy revisions and
-- before the first render. Blocking problems hold approval.
alter table public.marketing_revisions add column render_report jsonb
  check (render_report is null or (jsonb_typeof(render_report)='object' and jsonb_typeof(render_report->'problems')='array'));

create function marketing_private.revision_without_urls(p_revision jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_revision->'assets')='array' then jsonb_set(p_revision,'{assets}',coalesce(
   (select jsonb_agg(case when jsonb_typeof(asset)='object' then asset-'url' else asset end order by position)
    from jsonb_array_elements(p_revision->'assets') with ordinality as t(asset,position)),'[]'::jsonb))
  else p_revision end;
$$;
revoke all on function marketing_private.revision_without_urls(jsonb) from public,anon,authenticated;
grant execute on function marketing_private.revision_without_urls(jsonb) to service_role;

-- A report that is not a clean `rendered` result is blocking, including one
-- that cannot be read: it cannot be shown to be clean.
create function marketing_private.render_report_blocks(p_report jsonb)
returns boolean language sql immutable set search_path='' as $$
 select case
  when p_report is null then false
  when jsonb_typeof(p_report) is distinct from 'object' or jsonb_typeof(p_report->'problems') is distinct from 'array' then true
  when p_report->>'status' is distinct from 'rendered' then true
  else exists(select 1 from jsonb_array_elements(p_report->'problems') problem where problem->'blocking' is distinct from 'false'::jsonb)
 end;
$$;
revoke all on function marketing_private.render_report_blocks(jsonb) from public,anon,authenticated;
grant execute on function marketing_private.render_report_blocks(jsonb) to service_role;

-- Renew delivery URLs in place after the server re-verified the stored bytes
-- against assets[].sha256. Only assets[].url may change, each URL must still
-- name the same private object (only its signature query changes), and
-- content_hash, approved_hash, status and ready stay exactly as they were.
create function public.marketing_renew_revision_asset_urls(p_owner uuid,p_revision uuid,p_expected_hash text,p_assets jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_revisions; renewed jsonb;
begin
 if p_owner is null or p_revision is null or p_expected_hash is null or p_expected_hash !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_assets) is distinct from 'array' or jsonb_array_length(p_assets) not between 1 and 10
  or exists(select 1 from jsonb_array_elements(p_assets) asset where jsonb_typeof(asset) is distinct from 'object' or jsonb_typeof(asset->'url') is distinct from 'string')
 then raise exception 'renewal input invalid'; end if;
 select * into r from public.marketing_revisions where id=p_revision and user_id=p_owner for update;
 if not found then raise exception 'revision unavailable'; end if;
 if r.status not in ('review','approved') then raise exception 'revision not renewable'; end if;
 if r.content_hash<>p_expected_hash or (r.approved_hash is not null and r.approved_hash<>r.content_hash) then raise exception 'revision changed'; end if;
 if jsonb_typeof(r.revision->'assets') is distinct from 'array' or jsonb_array_length(r.revision->'assets')<>jsonb_array_length(p_assets) then raise exception 'renewal changes more than urls'; end if;
 renewed:=jsonb_set(r.revision,'{assets}',p_assets);
 if marketing_private.revision_without_urls(renewed) is distinct from marketing_private.revision_without_urls(r.revision) then raise exception 'renewal changes more than urls'; end if;
 if exists(
  select 1 from jsonb_array_elements(p_assets) with ordinality as n(asset,i) join jsonb_array_elements(r.revision->'assets') with ordinality as o(asset,i) using (i)
  where length(n.asset->>'url')>2048
   or (n.asset->>'url') !~ '^https://[^/?#@[:space:]]+/storage/v1/object/sign/marketing-assets/[^?#[:space:]]+[?]token=[^&#[:space:]]+$'
   or split_part(n.asset->>'url','?',1) is distinct from split_part(o.asset->>'url','?',1)
 ) then raise exception 'renewal url untrusted'; end if;
 update public.marketing_revisions set revision=renewed where id=r.id;
 return jsonb_build_object('revisionId',r.id,'contentHash',r.content_hash,'approvedHash',r.approved_hash,'status',r.status,'renewed',jsonb_array_length(p_assets));
end $$;
revoke all on function public.marketing_renew_revision_asset_urls(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_renew_revision_asset_urls(uuid,uuid,text,jsonb) to service_role;

-- An owner edit saves a deck revision without assets (ready=false), so nothing
-- can approve it yet. The render then attaches its JPEGs once: the deck, text,
-- account, schedule and sources stay byte-identical, and the server's new
-- content_hash covers the rendered asset hashes. A refused render keeps the
-- revision unready and records why.
create function public.marketing_attach_revision_render(p_owner uuid,p_revision uuid,p_expected_hash text,p_content jsonb,p_hash text,p_ready boolean,p_report jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare r public.marketing_revisions;
begin
 if p_owner is null or p_revision is null or p_ready is null or p_expected_hash is null or p_hash is null or p_expected_hash !~ '^[a-f0-9]{64}$' or p_hash !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_content) is distinct from 'object' or jsonb_typeof(p_content->'assets') is distinct from 'array'
  or jsonb_typeof(p_report) is distinct from 'object' or jsonb_typeof(p_report->'problems') is distinct from 'array'
 then raise exception 'render input invalid'; end if;
 select * into r from public.marketing_revisions where id=p_revision and user_id=p_owner for update;
 if not found then raise exception 'revision unavailable'; end if;
 if r.status<>'review' or r.ready or r.approved_hash is not null or r.approved_at is not null then raise exception 'revision not renderable'; end if;
 if r.content_hash<>p_expected_hash then raise exception 'revision changed'; end if;
 if jsonb_typeof(r.revision->'deck') is distinct from 'object' then raise exception 'revision has no deck'; end if;
 if jsonb_typeof(r.revision->'assets') is distinct from 'array' or jsonb_array_length(r.revision->'assets')<>0 then raise exception 'revision already rendered'; end if;
 if (p_content-'assets') is distinct from (r.revision-'assets') then raise exception 'render may only attach assets'; end if;
 if p_ready then
  if jsonb_array_length(p_content->'assets')<>jsonb_array_length(p_content->'deck'->'slides') or marketing_private.render_report_blocks(p_report) then raise exception 'render incomplete'; end if;
 elsif jsonb_array_length(p_content->'assets')<>0 or p_hash<>r.content_hash then raise exception 'unready render attaches nothing';
 end if;
 update public.marketing_revisions set revision=p_content,content_hash=p_hash,ready=p_ready,render_report=p_report where id=r.id;
 return jsonb_build_object('revisionId',r.id,'contentHash',p_hash,'ready',p_ready);
end $$;
revoke all on function public.marketing_attach_revision_render(uuid,uuid,text,jsonb,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_attach_revision_render(uuid,uuid,text,jsonb,text,boolean,jsonb) to service_role;

-- Same owner approval path as 20261012225640, plus two holds: a blocking
-- render report and a deck whose rendered assets do not match its slides.
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
 if r.status<>'approved' then insert into public.marketing_events(user_id,revision_id,kind,payload) values(r.user_id,r.id,'approved',jsonb_build_object('publicationId',publication)); end if;
 return publication;
end $$;
revoke all on function public.marketing_approve_revision(uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_approve_revision(uuid,text) to authenticated;
