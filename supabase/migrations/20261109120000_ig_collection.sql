-- IG Kolekce (owner request, 9 November 2026): the posts the owner saved on Instagram, kept in the existing
-- knowledge store. A saved post is a marketing_knowledge_sources row; these columns add what the collection shows
-- (author, collection names, thumbnail, the Claude digest) and its own processing state. Capture only stores and
-- deduplicates a post as `queued`. Scraping and summarizing start only when the owner clicks Process or Re-process.
-- No Instagram cookies, sessions or private Saved collection URLs are used anywhere (docs/ig-kolekce.md).

alter table public.marketing_knowledge_sources
 add column author text check (author is null or length(author) between 1 and 120),
 add column collections text[] not null default '{}',
 add column media jsonb,
 add column digest jsonb,
 add column collection_status text not null default 'queued'
  check (collection_status in ('queued','scraping','summarizing','done','restricted','failed')),
 add column collection_error text check (collection_error is null or collection_error ~ '^[a-z][a-z0-9-]{1,79}$'),
 add column processed_at timestamptz,
 -- The IG TIPS / Links record that already holds this post (owner rule: never scrape a post twice).
 add column ai_link_id uuid references public.ai_links(id) on delete set null;
update public.marketing_knowledge_sources set collection_status='restricted' where status='inaccessible';
create index marketing_knowledge_sources_collection_idx on public.marketing_knowledge_sources(user_id,collection_status,saved_at desc);

-- The owner's ai_links row (idea or link) whose url or source_urls name this shortcode, one with a summary first.
create function public.marketing_collection_tip(p_owner uuid,p_short text) returns table(id uuid,tip_summary text)
language sql stable set search_path=public,pg_temp as $$
 select l.id,nullif(btrim(l.tip_summary),'') from public.ai_links l
 where l.user_id=p_owner and exists(select 1 from unnest(array[l.url]||coalesce(l.source_urls,'{}')) u
  where substring(u from 'instagram\.com/(?:[A-Za-z0-9_.]+/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)')=p_short)
 order by (nullif(btrim(l.tip_summary),'') is null),l.id limit 1
$$;
revoke execute on function public.marketing_collection_tip(uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_collection_tip(uuid,text) to service_role;

-- A post already in IG TIPS with a summary is done and linked; one without a summary is done and linked too, and
-- is scraped only after the owner clicks Re-process on it.
create function public.marketing_collection_tip_digest(p_summary text) returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select case when p_summary is null then null else jsonb_build_object('summary',left(p_summary,800),'tips','[]'::jsonb,'tags','[]'::jsonb,'project',null,'fromTips',true) end
$$;
revoke execute on function public.marketing_collection_tip_digest(text) from public,anon,authenticated;
grant execute on function public.marketing_collection_tip_digest(text) to service_role;

-- Backfill: every Instagram shortcode the owners' ai_links already name joins the collection as done.
insert into public.marketing_knowledge_sources(user_id,shortcode,canonical_url,saved_at,saved_at_status,published_at,imported_at,cutoff,content,provenance,status,collection_status,ai_link_id,digest,processed_at)
select distinct on (l.user_id,m.code) l.user_id,m.code,'https://www.instagram.com/p/'||m.code||'/',null,'unknown',null,now(),now(),
 '{"caption":null,"captionProvider":null,"transcript":{"status":"not-requested","provider":null,"costUsd":null,"segments":[],"reason":"not-requested"},"ocr":{"status":"not-requested","provider":null,"costUsd":null,"segments":[],"reason":"not-requested"}}'::jsonb,
 'existing-tip','partial','done',l.id,public.marketing_collection_tip_digest(nullif(btrim(l.tip_summary),'')),now()
from public.ai_links l
cross join lateral (select substring(u from 'instagram\.com/(?:[A-Za-z0-9_.]+/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)') code from unnest(array[l.url]||coalesce(l.source_urls,'{}')) u) m
where m.code is not null and length(m.code)<=80
order by l.user_id,m.code,(nullif(btrim(l.tip_summary),'') is null),l.id
on conflict(user_id,shortcode) do nothing;

-- One row per owner: the hashed share token for the iOS Shortcut and the import high-water mark.
create table public.marketing_collection_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 share_token_hash text unique check (share_token_hash is null or share_token_hash ~ '^[a-f0-9]{64}$'),
 share_token_created_at timestamptz,
 high_water_saved_at timestamptz,
 last_import_at timestamptz,
 last_run_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.marketing_collection_settings enable row level security;
revoke all on public.marketing_collection_settings from public,anon,authenticated;
-- The client may read its own row but never the token hash.
grant select (user_id,share_token_created_at,high_water_saved_at,last_import_at,last_run_at,updated_at) on public.marketing_collection_settings to authenticated;
grant all on public.marketing_collection_settings to service_role;
create policy marketing_collection_settings_own on public.marketing_collection_settings for select to authenticated using (user_id=(select auth.uid()));

-- Stores new posts as queued. A shortcode already in the collection, or named by one of the owner's ai_links, is
-- skipped and never queued (its collection names and missing author/date merge in; a tip post joins as done and
-- linked). Only an Instagram export moves the high-water mark, so it says how far back the last export reached.
create function public.marketing_collection_import(p_owner uuid,p_rows jsonb,p_provenance text) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare r jsonb; short text; saved timestamptz; sid uuid; mark timestamptz; newest timestamptz; added jsonb:='[]';
 skipped_collection int:=0; skipped_tips int:=0; older int:=0; names text[]; stamp timestamptz:=now(); known public.marketing_knowledge_sources;
 tip record; empty_media constant jsonb:='{"status":"not-requested","provider":null,"costUsd":null,"segments":[],"reason":"not-requested"}';
begin
 if p_owner is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 or p_provenance not in ('instagram-export','manual') then raise exception 'invalid collection import'; end if;
 perform pg_advisory_xact_lock(hashtext('collection:'||p_owner::text));
 insert into public.marketing_collection_settings(user_id) values(p_owner) on conflict do nothing;
 select high_water_saved_at into mark from public.marketing_collection_settings where user_id=p_owner for update;
 for r in select value from jsonb_array_elements(p_rows) loop
  short:=r->>'shortcode';
  if short is null or short !~ '^[A-Za-z0-9_-]{1,80}$' then raise exception 'invalid collection row'; end if;
  saved:=nullif(r->>'saved_at','')::timestamptz;
  names:=array(select distinct left(n,120) from jsonb_array_elements_text(coalesce(r->'collections','[]'::jsonb)) n where length(n) between 1 and 120 limit 20);
  if p_provenance='instagram-export' and saved is not null then newest:=greatest(newest,saved); end if;
  select * into known from public.marketing_knowledge_sources where user_id=p_owner and shortcode=short for update;
  if found then
   if known.ai_link_id is not null or known.provenance='existing-tip' then skipped_tips:=skipped_tips+1; else skipped_collection:=skipped_collection+1; end if;
   update public.marketing_knowledge_sources set
    collections=array(select distinct c from unnest(collections||names) c),
    author=coalesce(author,nullif(left(r->>'author',120),'')),
    saved_at=coalesce(saved_at,saved), saved_at_status=case when saved_at is null and saved is not null then 'unverified' else saved_at_status end,
    updated_at=now()
   where id=known.id and (not collections@>names or (author is null and r->>'author' is not null) or (saved_at is null and saved is not null));
   continue;
  end if;
  select * into tip from public.marketing_collection_tip(p_owner,short);
  insert into public.marketing_knowledge_sources(user_id,shortcode,canonical_url,saved_at,saved_at_status,published_at,imported_at,cutoff,content,provenance,status,author,collections,collection_status,ai_link_id,digest,processed_at)
  values(p_owner,short,'https://www.instagram.com/p/'||short||'/',saved,case when saved is null then 'unknown' else 'unverified' end,null,stamp,stamp,
   jsonb_build_object('caption',null,'captionProvider',null,'transcript',empty_media,'ocr',empty_media),p_provenance,'partial',nullif(left(r->>'author',120),''),names,
   case when tip.id is null then 'queued' else 'done' end,tip.id,public.marketing_collection_tip_digest(tip.tip_summary),case when tip.id is null then null else stamp end)
  returning id into sid;
  if tip.id is not null then skipped_tips:=skipped_tips+1; continue; end if;
  added:=added||to_jsonb(sid);
  if p_provenance='instagram-export' and saved is not null and mark is not null and saved<=mark then older:=older+1; end if;
 end loop;
 update public.marketing_collection_settings set high_water_saved_at=greatest(high_water_saved_at,newest),last_import_at=stamp,updated_at=now() where user_id=p_owner returning high_water_saved_at into newest;
 return jsonb_build_object('added',jsonb_array_length(added),'sourceIds',added,'skipped',skipped_collection+skipped_tips,'skippedCollection',skipped_collection,'skippedTips',skipped_tips,
  'addedOlderThanMark',older,'previousHighWater',mark,'highWater',newest);
end $$;
revoke execute on function public.marketing_collection_import(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_collection_import(uuid,jsonb,text) to service_role;

-- Re-process: the owner puts finished, failed or restricted posts back in the queue.
create function public.marketing_collection_requeue(p_owner uuid,p_sources uuid[]) returns int
language plpgsql set search_path=public,pg_temp as $$
declare n int;
begin
 if p_owner is null or coalesce(cardinality(p_sources),0) not between 1 and 50 then raise exception 'invalid collection requeue'; end if;
 update public.marketing_knowledge_sources set collection_status='queued',collection_error=null,updated_at=now()
 where user_id=p_owner and id=any(p_sources) and collection_status in ('done','failed','restricted');
 get diagnostics n=row_count;
 return n;
end $$;
revoke execute on function public.marketing_collection_requeue(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.marketing_collection_requeue(uuid,uuid[]) to service_role;

-- Claim before any paid call: queued -> scraping exactly once. A second dispatch gets null.
create function public.marketing_collection_claim(p_owner uuid,p_source uuid) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare claimed public.marketing_knowledge_sources;
begin
 update public.marketing_knowledge_sources set collection_status='scraping',collection_error=null,updated_at=now()
 where id=p_source and user_id=p_owner and collection_status='queued' returning * into claimed;
 if not found then return null; end if;
 insert into public.marketing_collection_settings(user_id,last_run_at) values(p_owner,now())
 on conflict(user_id) do update set last_run_at=now(),updated_at=now();
 return to_jsonb(claimed);
end $$;
revoke execute on function public.marketing_collection_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_collection_claim(uuid,uuid) to service_role;

-- The end of one run: the digest, and the procedures as canonical ai_links ideas (needs review) through the
-- existing atomic import, in one transaction.
create function public.marketing_collection_finish(p_owner uuid,p_source uuid,p_status text,p_error text,p_digest jsonb,p_knowledge_source jsonb,p_items jsonb,p_event_id text) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare cur public.marketing_knowledge_sources; saved jsonb:=null;
begin
 if p_status not in ('done','restricted','failed') then raise exception 'invalid collection status'; end if;
 select * into cur from public.marketing_knowledge_sources where id=p_source and user_id=p_owner for update;
 if not found then raise exception 'collection source unavailable'; end if;
 if cur.collection_status not in ('scraping','summarizing') then raise exception 'collection source not running'; end if;
 if p_knowledge_source is not null then
  if p_knowledge_source->>'shortcode'<>cur.shortcode then raise exception 'collection source mismatch'; end if;
  saved:=public.marketing_import_knowledge(p_owner,jsonb_build_array(p_knowledge_source),coalesce(p_items,'[]'::jsonb),p_event_id);
 end if;
 update public.marketing_knowledge_sources set collection_status=p_status,collection_error=p_error,digest=coalesce(p_digest,digest),processed_at=now(),updated_at=now()
 where id=p_source and user_id=p_owner;
 return jsonb_build_object('status',p_status,'saved',saved);
end $$;
revoke execute on function public.marketing_collection_finish(uuid,uuid,text,text,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_collection_finish(uuid,uuid,text,text,jsonb,jsonb,jsonb,text) to service_role;
