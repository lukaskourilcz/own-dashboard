-- Exact approved-hash records for immutable MP4s; existing event history is unchanged.
create function public.record_owned_dneskai_reel(
 p_owner uuid,p_revision uuid,p_revision_hash text,p_reel_key text,p_audio_id uuid,p_sha256 text,p_bytes bigint
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
 current_hash text; saved_event public.marketing_events; expected_payload jsonb; was_created boolean:=false; stored_id uuid; observed_at timestamptz:=pg_catalog.clock_timestamp();
begin
 if p_owner is null or p_revision is null or p_revision_hash is null or p_revision_hash !~ '^[a-f0-9]{64}$'
  or p_reel_key is null or p_reel_key !~ '^[a-f0-9]{64}$' or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
  or p_bytes is null or p_bytes<1 or p_bytes>67108864 then
  raise exception 'Reel record invalid' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dneskai-reel-record:'||p_owner::text||':'||p_revision::text||':'||p_revision_hash||':'||p_reel_key,0));
 select r.content_hash into current_hash from public.marketing_revisions r
  where r.id=p_revision and r.user_id=p_owner for share;
 if not found or current_hash is distinct from p_revision_hash then
  raise exception 'Reel revision changed' using errcode='P0002';
 end if;
 expected_payload:=pg_catalog.jsonb_build_object('reelKey',p_reel_key,'revisionHash',p_revision_hash,'audioId',p_audio_id,'sha256',p_sha256,'bytes',p_bytes);
 select e.* into saved_event from public.marketing_events e
  where e.user_id=p_owner and e.revision_id=p_revision and e.kind='dneskai-reel-rendered'
   and e.payload->>'revisionHash'=p_revision_hash and e.payload->>'reelKey'=p_reel_key
  order by e.created_at desc,e.id desc limit 1;
 if not found then
  insert into public.marketing_events(user_id,revision_id,kind,payload,created_at,delivered_at)
   values(p_owner,p_revision,'dneskai-reel-rendered',expected_payload,observed_at,observed_at) returning * into saved_event;
  was_created:=true;
 end if;
 stored_id:=saved_event.id;
 select e.* into saved_event from public.marketing_events e where e.id=stored_id for share;
 if not found or saved_event.user_id is distinct from p_owner or saved_event.revision_id is distinct from p_revision
  or saved_event.kind is distinct from 'dneskai-reel-rendered'
  or pg_catalog.jsonb_typeof(saved_event.payload) is distinct from 'object'
  or not(saved_event.payload ?& array['reelKey','revisionHash','audioId','sha256','bytes'])
  or not(saved_event.payload @> expected_payload) or not pg_catalog.isfinite(saved_event.created_at)
  or saved_event.delivered_at is null or not pg_catalog.isfinite(saved_event.delivered_at)
  or was_created and (saved_event.created_at is distinct from observed_at or saved_event.delivered_at is distinct from observed_at) then
  raise exception 'Reel record unavailable' using errcode='40001';
 end if;
 return pg_catalog.jsonb_build_object('ownerId',p_owner,'revisionId',p_revision,'revisionHash',p_revision_hash,
  'reelKey',p_reel_key,'audioId',p_audio_id,'sha256',p_sha256,'bytes',p_bytes,
  'eventId',saved_event.id,'createdAt',saved_event.created_at,'created',was_created);
end;
$$;
revoke all on function public.record_owned_dneskai_reel(uuid,uuid,text,text,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.record_owned_dneskai_reel(uuid,uuid,text,text,uuid,text,bigint) to service_role;
comment on function public.record_owned_dneskai_reel(uuid,uuid,text,text,uuid,text,bigint) is
 'Service-only exact owner/revision/hash MP4 receipt; atomic identical retries preserve event history and refuse stale or contradictory records.';
