-- #114: DNESKAi source media. Research storage only: no revision, approval, calendar or publication authority.
-- The original pictures of a selected research candidate (every child of an Instagram carousel, the
-- og:image and body figures of a feed article) are stored once per owner under the sha256 of their bytes,
-- unchanged, because the studio renderer hashes exactly the bytes it draws. Origin and credit are always
-- recorded; there is no rights gate (owner decision 7, #110).
--
-- A separate private bucket: `marketing-assets` keeps its rendered-JPEG-only, 8 MiB contract. 32 MiB is the
-- studio's DNESKAI_MAX_IMAGE_BYTES; the collector itself downloads at most 8 MiB per picture.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('marketing-media','marketing-media',false,33554432,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set name=excluded.name,public=false,
 file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Owner-prefix reads for signed previews; the trusted collector writes with the service role only.
create policy marketing_media_owner_read on storage.objects
for select to authenticated using (
 bucket_id='marketing-media' and (storage.foldername(name))[1]=(select auth.uid())::text
);
-- Restrictive policies combine with any broader permissive policy of another feature.
create policy marketing_media_owner_read_guard on storage.objects as restrictive
for select to authenticated using (
 bucket_id<>'marketing-media' or (storage.foldername(name))[1]=(select auth.uid())::text
);
create policy marketing_media_anon_read_guard on storage.objects as restrictive
for select to anon using (bucket_id<>'marketing-media');
create policy marketing_media_browser_insert_guard on storage.objects as restrictive
for insert to anon,authenticated with check (bucket_id<>'marketing-media');
create policy marketing_media_browser_update_guard on storage.objects as restrictive
for update to anon,authenticated using (bucket_id<>'marketing-media')
with check (bucket_id<>'marketing-media');
create policy marketing_media_browser_delete_guard on storage.objects as restrictive
for delete to anon,authenticated using (bucket_id<>'marketing-media');

-- One row per distinct picture of an owner. candidate/source/external/origin/position/credit record where
-- it was first seen; every use by a candidate is a row in marketing_media_asset_links.
create table public.marketing_media_assets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 candidate_id text not null check(length(candidate_id) between 1 and 200),
 source_id text not null check(length(source_id) between 1 and 100),
 external_id text not null check(length(external_id) between 1 and 300),
 origin_url text not null check(origin_url ~ '^https://' and length(origin_url)<=2048),
 origin_kind text not null check(origin_kind in('instagram-display','instagram-child','og-image','article-figure','feed-image')),
 position integer not null check(position between 0 and 49),
 width integer not null check(width between 1 and 65535),
 height integer not null check(height between 1 and 65535),
 mime text not null check(mime in('image/jpeg','image/png','image/webp')),
 bytes integer not null check(bytes between 1 and 33554432),
 storage_path text not null,
 credit text not null check(length(btrim(credit)) between 1 and 120 and credit=btrim(credit)),
 fetched_at timestamptz not null default clock_timestamp(),
 phash text check(phash ~ '^[a-f0-9]{16}$'),
 duplicate_of_asset_id uuid references public.marketing_media_assets(id) on delete set null,
 purged_at timestamptz,
 unique(user_id,sha256),
 check(duplicate_of_asset_id is distinct from id),
 check(storage_path='marketing-media/'||user_id::text||'/'||sha256||'.'||case mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end)
);
create table public.marketing_media_asset_links (
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 candidate_id text not null,
 asset_id uuid not null references public.marketing_media_assets(id) on delete cascade,
 origin_url text not null check(origin_url ~ '^https://' and length(origin_url)<=2048),
 origin_kind text not null check(origin_kind in('instagram-display','instagram-child','og-image','article-figure','feed-image')),
 position integer not null check(position between 0 and 49),
 credit text not null check(length(btrim(credit)) between 1 and 120 and credit=btrim(credit)),
 linked_at timestamptz not null default clock_timestamp(),
 primary key(user_id,project_id,candidate_id,asset_id),
 unique(user_id,project_id,candidate_id,position),
 foreign key(user_id,project_id,candidate_id) references public.marketing_dneskai_candidates(user_id,project_id,id) on delete cascade
);
-- Per-candidate progress, so a repeated run downloads nothing again and a missing picture stays visible.
-- plan: the ordered pictures chosen for the candidate, fixed once set; skipped: per-position outcomes that
-- produced no link (exclusions and failures, with their retry count).
create table public.marketing_media_collections (
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 candidate_id text not null,
 status text not null default 'pending' check(status in('pending','complete','partial','failed','empty')),
 plan jsonb check(plan is null or (jsonb_typeof(plan)='array' and jsonb_array_length(plan)<=10)),
 skipped jsonb not null default '[]' check(jsonb_typeof(skipped)='array' and jsonb_array_length(skipped)<=12),
 page_status text not null default 'not-applicable' check(page_status in('not-applicable','pending','ok','failed')),
 page_attempts integer not null default 0 check(page_attempts between 0 and 3),
 page_error text check(page_error ~ '^[a-z0-9-]{1,64}$'),
 asset_count integer not null default 0 check(asset_count between 0 and 10),
 fence uuid,lease_until timestamptz,
 attempted_at timestamptz,completed_at timestamptz,
 primary key(user_id,project_id,candidate_id),
 foreign key(user_id,project_id,candidate_id) references public.marketing_dneskai_candidates(user_id,project_id,id) on delete cascade
);
create index marketing_media_owner_fetched on public.marketing_media_assets(user_id,fetched_at) where purged_at is null;
create index marketing_media_links_asset on public.marketing_media_asset_links(user_id,asset_id,linked_at desc);

-- Child ownership is checked even for service-role writes.
create function public.marketing_media_ownership() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.projects where id=new.project_id and user_id=new.user_id) then raise exception 'foreign media project';end if;
 -- Field access by name would fail on the tables that lack the column, so read it through jsonb.
 if tg_table_name='marketing_media_assets' then
  if (to_jsonb(new)->>'duplicate_of_asset_id') is not null and not exists(select 1 from public.marketing_media_assets where id=(to_jsonb(new)->>'duplicate_of_asset_id')::uuid and user_id=new.user_id) then raise exception 'foreign media asset';end if;
 elsif tg_table_name='marketing_media_asset_links' then
  if not exists(select 1 from public.marketing_media_assets where id=(to_jsonb(new)->>'asset_id')::uuid and user_id=new.user_id) then raise exception 'foreign media asset';end if;
 end if;
 return new;
end $$;
revoke all on function public.marketing_media_ownership() from public,anon,authenticated;
do $$ declare t text;begin foreach t in array array['marketing_media_assets','marketing_media_asset_links','marketing_media_collections'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
 execute format('create trigger media_ownership before insert or update on public.%I for each row execute function public.marketing_media_ownership()',t);
 end loop;end $$;

-- Claims one selected candidate for one collector invocation. A finished candidate (anything but pending)
-- and a candidate under another live lease are returned unclaimed, so nothing is fetched twice.
create function public.marketing_media_begin(p_owner uuid,p_project uuid,p_candidate text,p_fence uuid) returns jsonb language plpgsql set search_path='' as $$
declare c public.marketing_media_collections;cand public.marketing_dneskai_candidates;links jsonb;
begin
 select * into cand from public.marketing_dneskai_candidates where user_id=p_owner and project_id=p_project and id=p_candidate;
 if not found or cand.status<>'selected' then return jsonb_build_object('claimed',false,'reason','candidate-not-selected');end if;
 insert into public.marketing_media_collections(user_id,project_id,candidate_id) values(p_owner,p_project,p_candidate) on conflict do nothing;
 select * into c from public.marketing_media_collections where user_id=p_owner and project_id=p_project and candidate_id=p_candidate for update;
 if c.status<>'pending' then return jsonb_build_object('claimed',false,'reason','collection-finished','state',to_jsonb(c)-'fence'-'lease_until');end if;
 if c.lease_until>clock_timestamp() then return jsonb_build_object('claimed',false,'reason','collection-busy');end if;
 update public.marketing_media_collections set fence=p_fence,lease_until=clock_timestamp()+interval '120 seconds',attempted_at=clock_timestamp()
  where user_id=p_owner and project_id=p_project and candidate_id=p_candidate returning * into c;
 select coalesce(jsonb_agg(jsonb_build_object('position',l.position,'assetId',l.asset_id,'sha256',a.sha256) order by l.position),'[]') into links
  from public.marketing_media_asset_links l join public.marketing_media_assets a on a.id=l.asset_id
  where l.user_id=p_owner and l.project_id=p_project and l.candidate_id=p_candidate;
 return jsonb_build_object('claimed',true,'candidate',cand.candidate,'state',to_jsonb(c)-'fence'-'lease_until','links',links);
end $$;

-- Fixes the candidate's ordered picture plan once; a later pass works through the same positions.
-- A null plan records a failed article-page read that will be retried (at most three reads in total).
create function public.marketing_media_set_plan(p_owner uuid,p_project uuid,p_candidate text,p_fence uuid,p_plan jsonb,p_page_status text,p_page_error text) returns void language plpgsql set search_path='' as $$
declare c public.marketing_media_collections;e jsonb;positions integer[]:='{}';
begin
 select * into c from public.marketing_media_collections where user_id=p_owner and project_id=p_project and candidate_id=p_candidate and fence=p_fence and lease_until>clock_timestamp() for update;
 if not found then raise exception 'media fence unavailable';end if;
 if c.plan is not null then raise exception 'media plan already fixed';end if;
 if p_page_error is not null and p_page_error !~ '^[a-z0-9-]{1,64}$' then raise exception 'media plan invalid';end if;
 if p_plan is null then
  if p_page_status is distinct from 'failed' or c.page_attempts>=2 then raise exception 'media plan invalid';end if;
  update public.marketing_media_collections set page_status='failed',page_error=p_page_error,page_attempts=page_attempts+1
   where user_id=p_owner and project_id=p_project and candidate_id=p_candidate;
  return;
 end if;
 if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan)>10 or p_page_status is null or p_page_status not in('not-applicable','ok','failed') then raise exception 'media plan invalid';end if;
 for e in select value from jsonb_array_elements(p_plan) loop
  if jsonb_typeof(e->'position') is distinct from 'number' or (e->>'position')::int not between 0 and 49 or (e->>'position')::int=any(positions)
   or coalesce(e->>'url','') !~ '^https://' or length(e->>'url')>2048 or (e ? 'fallbackUrl' and (coalesce(e->>'fallbackUrl','') !~ '^https://' or length(e->>'fallbackUrl')>2048))
   or e->>'kind' not in('instagram-display','instagram-child','og-image','article-figure','feed-image') then raise exception 'media plan invalid';end if;
  positions:=positions||(e->>'position')::int;
 end loop;
 update public.marketing_media_collections set plan=p_plan,page_status=p_page_status,page_error=p_page_error,
  page_attempts=case when p_page_status='not-applicable' then page_attempts else least(page_attempts+1,3) end
  where user_id=p_owner and project_id=p_project and candidate_id=p_candidate;
end $$;

-- Records one stored picture for one plan position. A new sha256 needs uploaded=true (the object exists
-- before the row does); a purged asset comes back only with a fresh upload. A near-identical picture
-- (pHash Hamming distance <= 6) is marked as a duplicate of the larger one, which stays canonical.
create function public.marketing_media_record_asset(p_owner uuid,p_project uuid,p_candidate text,p_fence uuid,p_asset jsonb) returns jsonb language plpgsql set search_path='' as $$
declare c public.marketing_media_collections;cand public.marketing_dneskai_candidates;a public.marketing_media_assets;near public.marketing_media_assets;canonical public.marketing_media_assets;
 v_sha text:=p_asset->>'sha256';v_pos integer;v_mime text:=p_asset->>'mime';v_phash text:=nullif(p_asset->>'phash','');created boolean:=false;linked integer;
begin
 select * into c from public.marketing_media_collections where user_id=p_owner and project_id=p_project and candidate_id=p_candidate and fence=p_fence and lease_until>clock_timestamp() for update;
 if not found then raise exception 'media fence unavailable';end if;
 if jsonb_typeof(p_asset->'position') is distinct from 'number' then raise exception 'media asset invalid';end if;
 v_pos:=(p_asset->>'position')::int;
 if c.plan is null or not exists(select 1 from jsonb_array_elements(c.plan) e where (e->>'position')::int=v_pos and e->>'kind'=p_asset->>'originKind' and (e->>'url'=p_asset->>'originUrl' or e->>'fallbackUrl'=p_asset->>'originUrl')) then raise exception 'media asset outside plan';end if;
 select * into cand from public.marketing_dneskai_candidates where user_id=p_owner and project_id=p_project and id=p_candidate;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-media',0));
 select * into a from public.marketing_media_assets where user_id=p_owner and sha256=v_sha for update;
 if not found then
  if (p_asset->>'uploaded') is distinct from 'true' then raise exception 'media asset upload required';end if;
  insert into public.marketing_media_assets(user_id,project_id,sha256,candidate_id,source_id,external_id,origin_url,origin_kind,position,width,height,mime,bytes,storage_path,credit,phash)
  values(p_owner,p_project,v_sha,p_candidate,cand.candidate->>'sourceId',cand.candidate->>'externalId',p_asset->>'originUrl',p_asset->>'originKind',v_pos,(p_asset->>'width')::int,(p_asset->>'height')::int,v_mime,(p_asset->>'bytes')::int,
   'marketing-media/'||p_owner::text||'/'||v_sha||'.'||case v_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end,p_asset->>'credit',v_phash)
  returning * into a;created:=true;
  if a.phash is not null then
   select * into near from public.marketing_media_assets m where m.user_id=p_owner and m.id<>a.id and m.purged_at is null and m.phash is not null
    and bit_count(('x'||m.phash)::bit(64) # ('x'||a.phash)::bit(64))<=6
    order by bit_count(('x'||m.phash)::bit(64) # ('x'||a.phash)::bit(64)),m.fetched_at,m.id limit 1;
   if found then
    select * into canonical from public.marketing_media_assets where id=coalesce(near.duplicate_of_asset_id,near.id);
    if canonical.purged_at is not null then canonical:=near;end if;
    if (a.width::bigint*a.height,a.bytes)>(canonical.width::bigint*canonical.height,canonical.bytes) then
     update public.marketing_media_assets set duplicate_of_asset_id=a.id where user_id=p_owner and id<>a.id and (id=canonical.id or duplicate_of_asset_id=canonical.id);
    else
     update public.marketing_media_assets set duplicate_of_asset_id=canonical.id where id=a.id returning * into a;
    end if;
   end if;
  end if;
 else
  -- The same sha256 is the same bytes: anything else is a caller bug, never a second identity.
  if a.width<>(p_asset->>'width')::int or a.height<>(p_asset->>'height')::int or a.mime<>v_mime or a.bytes<>(p_asset->>'bytes')::int then raise exception 'media asset metadata mismatch';end if;
  if a.purged_at is not null then
   if (p_asset->>'uploaded') is distinct from 'true' then raise exception 'media asset upload required';end if;
   update public.marketing_media_assets set purged_at=null where id=a.id returning * into a;
  end if;
 end if;
 insert into public.marketing_media_asset_links(user_id,project_id,candidate_id,asset_id,origin_url,origin_kind,position,credit)
 values(p_owner,p_project,p_candidate,a.id,p_asset->>'originUrl',p_asset->>'originKind',v_pos,p_asset->>'credit') on conflict do nothing;
 select position into linked from public.marketing_media_asset_links where user_id=p_owner and project_id=p_project and candidate_id=p_candidate and asset_id=a.id;
 return jsonb_build_object('assetId',a.id,'sha256',a.sha256,'created',created,'linkedPosition',linked,'duplicateOfAssetId',a.duplicate_of_asset_id);
end $$;

-- Ends one pass. The caller computes the outcome; the database keeps the count of what is really linked.
create function public.marketing_media_finish(p_owner uuid,p_project uuid,p_candidate text,p_fence uuid,p_status text,p_skipped jsonb) returns jsonb language plpgsql set search_path='' as $$
declare c public.marketing_media_collections;linked integer;
begin
 select * into c from public.marketing_media_collections where user_id=p_owner and project_id=p_project and candidate_id=p_candidate and fence=p_fence and lease_until>clock_timestamp() for update;
 if not found then raise exception 'media fence unavailable';end if;
 if p_status not in('pending','complete','partial','failed','empty') or jsonb_typeof(p_skipped) is distinct from 'array' or jsonb_array_length(p_skipped)>12
  or exists(select 1 from jsonb_array_elements(p_skipped) s where jsonb_typeof(s->'position') is distinct from 'number' or coalesce(s->>'code','') !~ '^[a-z0-9-]{1,64}$' or jsonb_typeof(s->'retryable') is distinct from 'boolean' or jsonb_typeof(s->'attempts') is distinct from 'number') then raise exception 'media result invalid';end if;
 select count(*) into linked from public.marketing_media_asset_links where user_id=p_owner and project_id=p_project and candidate_id=p_candidate;
 if (p_status in('complete','partial') and linked=0) or (p_status in('failed','empty') and linked>0) then raise exception 'media result invalid';end if;
 update public.marketing_media_collections set status=p_status,skipped=p_skipped,asset_count=linked,fence=null,lease_until=null,
  completed_at=case when p_status='pending' then null else clock_timestamp() end
  where user_id=p_owner and project_id=p_project and candidate_id=p_candidate returning * into c;
 return to_jsonb(c)-'fence'-'lease_until';
end $$;

-- The asset behind one sha256, for the collector (upload needed?) and the byte loader.
create function public.marketing_media_lookup(p_owner uuid,p_sha256 text) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',id,'sha256',sha256,'storagePath',storage_path,'mime',mime,'bytes',bytes,'width',width,'height',height,'purgedAt',purged_at)
 from public.marketing_media_assets where user_id=p_owner and sha256=p_sha256
$$;

-- Retention: marks assets that no revision deck draws and no candidate linked within the window as purged,
-- and returns their storage paths for deletion. Rows stay; a later fetch of the same bytes re-uploads.
create function public.marketing_media_claim_purge(p_owner uuid,p_older_than_days integer,p_limit integer) returns jsonb language plpgsql set search_path='' as $$
declare cutoff timestamptz;result jsonb;
begin
 if p_older_than_days is null or p_older_than_days<1 or p_older_than_days>365 or p_limit is null or p_limit<1 or p_limit>500 then raise exception 'media purge invalid';end if;
 cutoff:=clock_timestamp()-make_interval(days=>p_older_than_days);
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'dneskai-media',0));
 -- Every revision of the owner counts, whatever its status: a returned or superseded deck can be restored.
 with referenced as (
  select distinct sha #>> '{}' as sha256 from public.marketing_revisions r,
   lateral jsonb_path_query(r.revision,'$.deck.slides[*].images[*].assetSha256') sha
  where r.user_id=p_owner
 ), eligible as (
  select a.id from public.marketing_media_assets a
  where a.user_id=p_owner and a.purged_at is null and a.fetched_at<cutoff
   and not exists(select 1 from public.marketing_media_asset_links l where l.user_id=p_owner and l.asset_id=a.id and l.linked_at>=cutoff)
   and not exists(select 1 from referenced where referenced.sha256=a.sha256)
  order by a.fetched_at,a.id limit p_limit for update of a skip locked
 ), marked as (
  update public.marketing_media_assets a set purged_at=clock_timestamp() from eligible where a.id=eligible.id returning a.id,a.storage_path
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'storagePath',storage_path) order by storage_path),'[]') into result from marked;
 return result;
end $$;

-- Undoes a purge mark when the storage deletion did not happen, so the next daily pass tries again.
create function public.marketing_media_unmark_purge(p_owner uuid,p_ids jsonb) returns integer language plpgsql set search_path='' as $$
declare n integer;
begin
 if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)>500 then raise exception 'media purge invalid';end if;
 update public.marketing_media_assets set purged_at=null where user_id=p_owner and purged_at is not null and id in(select (value#>>'{}')::uuid from jsonb_array_elements(p_ids));
 get diagnostics n=row_count;return n;
end $$;

revoke all on function public.marketing_media_begin(uuid,uuid,text,uuid),public.marketing_media_set_plan(uuid,uuid,text,uuid,jsonb,text,text),public.marketing_media_record_asset(uuid,uuid,text,uuid,jsonb),public.marketing_media_finish(uuid,uuid,text,uuid,text,jsonb),public.marketing_media_lookup(uuid,text),public.marketing_media_claim_purge(uuid,integer,integer),public.marketing_media_unmark_purge(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_media_begin(uuid,uuid,text,uuid),public.marketing_media_set_plan(uuid,uuid,text,uuid,jsonb,text,text),public.marketing_media_record_asset(uuid,uuid,text,uuid,jsonb),public.marketing_media_finish(uuid,uuid,text,uuid,text,jsonb),public.marketing_media_lookup(uuid,text),public.marketing_media_claim_purge(uuid,integer,integer),public.marketing_media_unmark_purge(uuid,jsonb) to service_role;
