-- Match source cleanup's lock order before acquiring private application state.
-- Retain the legacy RPC, idempotent request, owner day and snapshot semantics.
set lock_timeout='5s';
create or replace function public.record_job_application(p_request_id uuid, p_saved_id uuid, p_payload jsonb)
returns public.job_applications language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare
  actor uuid := auth.uid();
  saved public.saved_job_positions;
  result public.job_applications;
  sent_on date := (p_payload->>'applied_on')::date;
begin
  if actor is null or p_request_id is null then raise exception 'Authentication and request ID required' using errcode='42501'; end if;
  if p_saved_id is not null and p_request_id <> p_saved_id then raise exception 'Saved request ID mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || p_request_id::text,0));
  select * into result from public.job_applications where user_id=actor and request_id=p_request_id;
  if found then return result; end if;
  -- Source cleanup locks the global row before its FK updates touch private
  -- snapshots. Take the same source guard before locking the Saved row, so
  -- conversion cannot hold it while waiting on that global FK target.
  perform pg_advisory_xact_lock_shared(hashtextextended('own-dashboard-career-listings',0));
  if p_saved_id is not null then
    select * into saved from public.saved_job_positions where id=p_saved_id and user_id=actor for update;
    if not found then raise exception 'Saved position not found' using errcode='P0002'; end if;
  end if;
  if p_payload ? 'remote' and jsonb_typeof(p_payload->'remote') not in ('boolean','null') then raise exception 'Invalid remote evidence' using errcode='22023'; end if;
  if length(btrim(coalesce(p_payload->>'title',''))) not between 1 and 300 then raise exception 'Position required'; end if;
  if sent_on is null or sent_on > public.current_owner_day() then raise exception 'Invalid application date'; end if;
  if nullif(p_payload->>'url','') is not null and p_payload->>'url' !~ '^https?://[^/[:space:]]+' then raise exception 'Invalid posting URL'; end if;
  insert into public.job_applications(user_id,listing_id,title,company,url,source,location,remote,cover_letter,cover_letter_url,notes,applied_on,request_id)
  values(actor,case when p_saved_id is not null then saved.listing_id else nullif(p_payload->>'listing_id','')::uuid end,
    btrim(p_payload->>'title'),nullif(btrim(p_payload->>'company'),''),nullif(p_payload->>'url',''),
    coalesce(saved.source,p_payload->>'source'),coalesce(saved.location,p_payload->>'location'),
    case when p_saved_id is not null then saved.remote else (p_payload->>'remote')::boolean end,
    coalesce(p_payload->>'cover_letter',saved.cover_letter,''),nullif(p_payload->>'cover_letter_url',''),
    nullif(p_payload->>'notes',''),sent_on,p_request_id) returning * into result;
  insert into public.job_application_events(user_id,application_id,kind,detail) values(actor,result.id,'applied',sent_on::text);
  if p_saved_id is not null then delete from public.saved_job_positions where id=p_saved_id and user_id=actor; end if;
  return result;
end $$;
revoke all on function public.record_job_application(uuid,uuid,jsonb) from public,anon;
grant execute on function public.record_job_application(uuid,uuid,jsonb) to authenticated;
reset lock_timeout;
