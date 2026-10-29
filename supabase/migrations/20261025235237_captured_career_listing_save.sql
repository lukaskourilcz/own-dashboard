-- Discovery capture must never upsert over a private draft from another window.
set lock_timeout='5s';
create function public.capture_career_listing(
 p_expected_owner uuid,p_saved_id uuid,p_listing_id uuid,p_last_seen_at timestamptz,p_url text
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare actor uuid:=(select auth.uid()); saved public.saved_job_positions; listing public.job_listings; created boolean:=false; result jsonb;
begin
 if actor is null or p_expected_owner is null or actor<>p_expected_owner then raise exception 'Career owner unavailable' using errcode='42501'; end if;
 if p_saved_id is null or p_listing_id is null or p_last_seen_at is null or not isfinite(p_last_seen_at)
  or p_url is null or length(p_url) not between 1 and 2048 or p_url !~ '^https://[^/[:space:]]+' then
  raise exception 'Career capture unavailable' using errcode='22023';
 end if;
 -- Serialize only this owner's short captures. No provider work runs in this transaction.
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':career-capture',0));
 select * into saved from public.saved_job_positions where user_id=actor and id=p_saved_id for update;
 if found and saved.url<>p_url then raise exception 'Career capture changed' using errcode='P0002'; end if;
 if saved.id is null then
  select * into saved from public.saved_job_positions where user_id=actor and url=p_url for update;
 end if;
 if saved.id is null then
  -- Source writers/cleanup use the matching exclusive guard. A shared advisory
  -- guard needs no global-listing UPDATE grant or RLS bypass, unlike FOR SHARE.
  perform pg_advisory_xact_lock_shared(hashtextextended('own-dashboard-career-listings',0));
  select * into listing from public.job_listings l where l.id=p_listing_id and l.last_seen_at=p_last_seen_at and l.url=p_url
   and not exists(select 1 from public.job_user_state s where s.user_id=actor and s.listing_id=l.id and s.state='deleted');
  if not found then raise exception 'Career capture changed' using errcode='P0002'; end if;
  insert into public.saved_job_positions(id,user_id,listing_id,title,company,url,source,location,description,remote)
   values(p_saved_id,actor,listing.id,listing.title,listing.company,listing.url,listing.source,listing.location,listing.description,
    case when listing.source ~ '^(ashby|lever|greenhouse)-' then listing.remote and listing.native_remote_verified else listing.remote end)
   on conflict(user_id,url) do nothing returning * into saved;
  created:=found;
  if not created then
   select * into saved from public.saved_job_positions where user_id=actor and url=p_url for update;
   if not found then raise exception 'Career capture unavailable' using errcode='P0002'; end if;
  end if;
 end if;
 result:=jsonb_build_object('ownerId',actor,'requestId',p_saved_id,'created',created,'row',jsonb_build_object(
  'id',saved.id,'user_id',saved.user_id,'listing_id',saved.listing_id,'title',saved.title,'company',saved.company,
  'url',saved.url,'source',saved.source,'location',saved.location,'remote',saved.remote,'description',saved.description,
  'cover_letter',saved.cover_letter,'notes',saved.notes,'saved_at',saved.saved_at,'updated_at',saved.updated_at,
  'cover_letter_url',saved.cover_letter_url,'readiness',saved.readiness));
 if octet_length(result::text)>10*1024*1024 then raise exception 'Career capture exceeded' using errcode='54000'; end if;
 return result;
end $$;
revoke all on function public.capture_career_listing(uuid,uuid,uuid,timestamptz,text) from public,anon,service_role;
grant execute on function public.capture_career_listing(uuid,uuid,uuid,timestamptz,text) to authenticated;
comment on function public.capture_career_listing(uuid,uuid,uuid,timestamptz,text) is
 'Captured-owner/version discovery save; stable retry and existing private snapshots are returned unchanged under invoker RLS.';
reset lock_timeout;
