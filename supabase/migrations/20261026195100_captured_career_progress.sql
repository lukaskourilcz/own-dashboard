-- Capture the application version before editing; progress and contacts commit together.
create function public.update_captured_job_application(
 p_expected_owner uuid,p_id uuid,p_updated_at timestamptz,p_patch jsonb
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=(select auth.uid()); before_row public.job_applications; after_row public.job_applications;
 field text; event_row public.job_application_events; events jsonb:='[]'::jsonb; projected jsonb; result jsonb;
begin
 if actor is null or p_expected_owner is null or actor<>p_expected_owner then raise exception 'Career owner unavailable' using errcode='42501'; end if;
 if p_id is null or p_updated_at is null or not isfinite(p_updated_at)
  or jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text)>262144 then
  raise exception 'Career progress invalid' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k not in('status','responded_on','response_kind','next_follow_up_at','notes','contact_name','contact_email')) then
  raise exception 'Career progress invalid' using errcode='22023';
 end if;
 for field in select jsonb_object_keys(p_patch) loop
  if jsonb_typeof(p_patch->field) not in ('string','null') then raise exception 'Career progress invalid' using errcode='22023'; end if;
 end loop;
 if p_patch?'status' and (jsonb_typeof(p_patch->'status') is distinct from 'string' or p_patch->>'status' not in('applied','interviewing','offer','rejected','withdrawn'))
  or p_patch?'response_kind' and p_patch->>'response_kind' not in('positive','negative','neutral')
  or length(p_patch->>'notes')>30000 or length(p_patch->>'contact_name')>200 or length(p_patch->>'contact_email')>200
  or coalesce(p_patch->>'contact_email','') ~ '[[:space:][:cntrl:]]'
  or p_patch->>'contact_email' is not null and p_patch->>'contact_email' !~ '^[^@]+@[^@]+[.][^@]+$' then
  raise exception 'Career progress invalid' using errcode='22023';
 end if;
 select * into before_row from public.job_applications where id=p_id and user_id=actor for update;
 if not found or before_row.updated_at<>p_updated_at then raise exception 'Career progress changed' using errcode='P0002'; end if;
 after_row:=before_row;
 if p_patch?'status' then after_row.status:=p_patch->>'status'; end if;
 if p_patch?'response_kind' then after_row.response_kind:=p_patch->>'response_kind'; end if;
 if p_patch?'notes' then after_row.notes:=p_patch->>'notes'; end if;
 if p_patch?'contact_name' then after_row.contact_name:=p_patch->>'contact_name'; end if;
 if p_patch?'contact_email' then after_row.contact_email:=p_patch->>'contact_email'; end if;
 if p_patch?'responded_on' then
  if p_patch->>'responded_on' is not null and p_patch->>'responded_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Career progress invalid' using errcode='22023'; end if;
  begin after_row.responded_on:=(p_patch->>'responded_on')::date; exception when others then raise exception 'Career progress invalid' using errcode='22023'; end;
 end if;
 if p_patch?'next_follow_up_at' then
  if p_patch->>'next_follow_up_at' is not null and p_patch->>'next_follow_up_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Career progress invalid' using errcode='22023'; end if;
  begin after_row.next_follow_up_at:=(p_patch->>'next_follow_up_at')::timestamptz; exception when others then raise exception 'Career progress invalid' using errcode='22023'; end;
  if after_row.next_follow_up_at is not null and not isfinite(after_row.next_follow_up_at) then raise exception 'Career progress invalid' using errcode='22023'; end if;
 end if;
 if (after_row.responded_on is null)<>(after_row.response_kind is null)
  or after_row.responded_on<after_row.applied_on or after_row.responded_on>public.current_owner_day() then
  raise exception 'Career progress invalid' using errcode='22023';
 end if;
 if (before_row.status,before_row.responded_on,before_row.response_kind,before_row.next_follow_up_at,before_row.notes,before_row.contact_name,before_row.contact_email) is distinct from
    (after_row.status,after_row.responded_on,after_row.response_kind,after_row.next_follow_up_at,after_row.notes,after_row.contact_name,after_row.contact_email) then
  update public.job_applications set status=after_row.status,responded_on=after_row.responded_on,response_kind=after_row.response_kind,
   next_follow_up_at=after_row.next_follow_up_at,notes=after_row.notes,contact_name=after_row.contact_name,contact_email=after_row.contact_email
   where id=p_id and user_id=actor and updated_at=p_updated_at returning * into after_row;
  if not found then raise exception 'Career progress changed' using errcode='P0002'; end if;
 end if;
 -- Keep existing history semantics: stage changes and response/follow-up/note changes.
 -- Contacts were previously history-free, but are now part of this same transaction.
 if before_row.status is distinct from after_row.status then
  insert into public.job_application_events(user_id,application_id,kind,detail) values(actor,p_id,'status',after_row.status) returning * into event_row;
  events:=events||jsonb_build_array(jsonb_build_object('id',event_row.id,'user_id',actor,'application_id',p_id,'kind',event_row.kind,'detail',event_row.detail,'created_at',event_row.created_at));
 end if;
 if (before_row.responded_on,before_row.response_kind,before_row.next_follow_up_at,before_row.notes) is distinct from
    (after_row.responded_on,after_row.response_kind,after_row.next_follow_up_at,after_row.notes) then
  insert into public.job_application_events(user_id,application_id,kind,detail) values(actor,p_id,'note',jsonb_build_object('responded_on',after_row.responded_on,'response_kind',after_row.response_kind,'follow_up_at',after_row.next_follow_up_at,'notes',after_row.notes)::text) returning * into event_row;
  events:=events||jsonb_build_array(jsonb_build_object('id',event_row.id,'user_id',actor,'application_id',p_id,'kind',event_row.kind,'detail',event_row.detail,'created_at',event_row.created_at));
 end if;
 select to_jsonb(a) into projected from (
  select id,user_id,listing_id,title,company,url,source,location,remote,cover_letter,status,applied_on,notes,created_at,updated_at,
   organization_id,next_follow_up_at,cover_letter_url,request_id,responded_on,response_kind,contact_name,contact_email
  from public.job_applications where id=p_id and user_id=actor
 ) a;
 result:=jsonb_build_object('ownerId',actor,'source',jsonb_build_object('id',p_id,'updatedAt',p_updated_at),'row',projected,'events',events);
 if octet_length(result::text)>10485760 then raise exception 'Career progress exceeded' using errcode='54000'; end if;
 return result;
end $$;
revoke all on function public.update_captured_job_application(uuid,uuid,timestamptz,jsonb) from public,anon,service_role;
grant execute on function public.update_captured_job_application(uuid,uuid,timestamptz,jsonb) to authenticated;
comment on function public.update_captured_job_application(uuid,uuid,timestamptz,jsonb) is
 'Captured own application-version patch; progress, contacts and explicit action receipts share one transaction. Legacy RPC retained.';
