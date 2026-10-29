-- Align application date validation with the owner's configured day, including midnight and DST.
-- Own-only preferences are read through the caller's session; there is no definer bypass.
create function public.current_owner_day()
returns date language plpgsql stable security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); zone text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select timezone into zone from public.user_preferences where user_id=actor;
  begin
    return (now() at time zone coalesce(zone, 'Europe/Prague'))::date;
  exception when invalid_parameter_value then
    return (now() at time zone 'Europe/Prague')::date;
  end;
end $$;
revoke all on function public.current_owner_day() from public, anon, service_role;
grant execute on function public.current_owner_day() to authenticated;

-- Keep the existing transactional/idempotent behavior; only the future-date boundary changes.
create or replace function public.record_job_application(p_request_id uuid, p_saved_id uuid, p_payload jsonb)
returns public.job_applications language plpgsql security invoker set search_path = '' as $$
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
  if p_saved_id is not null then
    select * into saved from public.saved_job_positions where id=p_saved_id and user_id=actor for update;
    if not found then raise exception 'Saved position not found' using errcode='P0002'; end if;
  end if;
  if length(btrim(coalesce(p_payload->>'title',''))) not between 1 and 200 then raise exception 'Position required'; end if;
  if sent_on is null or sent_on > public.current_owner_day() then raise exception 'Invalid application date'; end if;
  if nullif(p_payload->>'url','') is not null and p_payload->>'url' !~ '^https?://[^/[:space:]]+' then raise exception 'Invalid posting URL'; end if;
  insert into public.job_applications(user_id,listing_id,title,company,url,source,location,cover_letter,cover_letter_url,notes,applied_on,request_id)
  values(actor,case when p_saved_id is not null then saved.listing_id else nullif(p_payload->>'listing_id','')::uuid end,
    btrim(p_payload->>'title'),nullif(btrim(p_payload->>'company'),''),nullif(p_payload->>'url',''),
    coalesce(saved.source,p_payload->>'source'),coalesce(saved.location,p_payload->>'location'),
    coalesce(p_payload->>'cover_letter',saved.cover_letter,''),nullif(p_payload->>'cover_letter_url',''),
    nullif(p_payload->>'notes',''),sent_on,p_request_id) returning * into result;
  insert into public.job_application_events(user_id,application_id,kind,detail) values(actor,result.id,'applied',sent_on::text);
  if p_saved_id is not null then delete from public.saved_job_positions where id=p_saved_id and user_id=actor; end if;
  return result;
end $$;
revoke all on function public.record_job_application(uuid,uuid,jsonb) from public,anon;
grant execute on function public.record_job_application(uuid,uuid,jsonb) to authenticated;

create or replace function public.update_job_application_progress(p_id uuid,p_status text,p_responded_on date,p_response_kind text,p_follow_up_at timestamptz,p_notes text)
returns public.job_applications language plpgsql security invoker set search_path = '' as $$
declare actor uuid:=auth.uid(); old_row public.job_applications; result public.job_applications;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into old_row from public.job_applications where id=p_id and user_id=actor for update;
  if not found then raise exception 'Application not found' using errcode='P0002'; end if;
  if p_responded_on > public.current_owner_day() then raise exception 'Response cannot be in the future'; end if;
  update public.job_applications set status=p_status,responded_on=p_responded_on,response_kind=p_response_kind,
    next_follow_up_at=p_follow_up_at,notes=nullif(p_notes,''),updated_at=now() where id=p_id and user_id=actor returning * into result;
  if old_row.status is distinct from result.status then
    insert into public.job_application_events(user_id,application_id,kind,detail) values(actor,p_id,'status',result.status);
  end if;
  if (old_row.responded_on,old_row.response_kind,old_row.next_follow_up_at,old_row.notes) is distinct from
     (result.responded_on,result.response_kind,result.next_follow_up_at,result.notes) then
    insert into public.job_application_events(user_id,application_id,kind,detail)
    values(actor,p_id,'note',jsonb_build_object('responded_on',result.responded_on,'response_kind',result.response_kind,'follow_up_at',result.next_follow_up_at,'notes',result.notes)::text);
  end if;
  return result;
end $$;
revoke all on function public.update_job_application_progress(uuid,text,date,text,timestamptz,text) from public,anon;
grant execute on function public.update_job_application_progress(uuid,text,date,text,timestamptz,text) to authenticated;
