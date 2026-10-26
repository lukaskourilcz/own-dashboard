-- New captured conversion keeps the legacy RPC available during rollout.
set lock_timeout='5s';
alter table public.job_applications add column request_fingerprint text
 check(request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');
comment on column public.job_applications.request_fingerprint is
 'Original captured conversion identity; null preserves legacy history. Never an API credential.';

create function public.record_captured_job_application(
 p_expected_owner uuid,p_saved_id uuid,p_saved_updated_at timestamptz,p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=(select auth.uid()); saved public.saved_job_positions; app public.job_applications;
 fields jsonb; fingerprint text; sent_on date; created boolean:=false; app_row jsonb; event_rows jsonb; result jsonb; field text;
begin
 if actor is null or p_expected_owner is null or actor<>p_expected_owner then raise exception 'Career owner unavailable' using errcode='42501'; end if;
 if p_saved_id is null or p_saved_updated_at is null or not isfinite(p_saved_updated_at)
 then raise exception 'Career application invalid' using errcode='22023'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>262144 then raise exception 'Career application invalid' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(p_payload))<>7
  or exists(select 1 from jsonb_object_keys(p_payload) k where k not in('title','company','url','cover_letter','cover_letter_url','applied_on','notes'))
  or jsonb_typeof(p_payload->'title') is distinct from 'string'
  or length(btrim(p_payload->>'title')) not between 1 and 300
  or jsonb_typeof(p_payload->'cover_letter') is distinct from 'string' or length(p_payload->>'cover_letter')>64000
  or jsonb_typeof(p_payload->'applied_on') is distinct from 'string' or (p_payload->>'applied_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
  raise exception 'Career application invalid' using errcode='22023';
 end if;
 foreach field in array array['company','url','cover_letter_url','notes'] loop
  if jsonb_typeof(p_payload->field) not in ('string','null') then raise exception 'Career application invalid' using errcode='22023'; end if;
 end loop;
 if length(p_payload->>'company')>500 or length(p_payload->>'url')>2048 or length(p_payload->>'cover_letter_url')>2048 or length(p_payload->>'notes')>30000 then raise exception 'Career application invalid' using errcode='22023'; end if;
 fields:=jsonb_build_object('title',btrim(p_payload->>'title'),'company',nullif(btrim(p_payload->>'company'),''),
  'url',nullif(btrim(p_payload->>'url'),''),'cover_letter',p_payload->>'cover_letter',
  'cover_letter_url',nullif(btrim(p_payload->>'cover_letter_url'),''),'applied_on',p_payload->>'applied_on','notes',nullif(btrim(p_payload->>'notes'),''));
 if fields->>'url' is not null and (fields->>'url' !~ '^https?://[^/?#[:space:]@\\]+([/?#][^[:cntrl:]]*)?$' or fields->>'url' ~ '[[:cntrl:]]') then raise exception 'Career application invalid' using errcode='22023'; end if;
 if fields->>'cover_letter_url' is not null and fields->>'cover_letter_url' !~ '^https://(docs[.]google[.]com/document/d/|drive[.]google[.]com/file/d/)[A-Za-z0-9_-]+([/?#][^[:cntrl:]]*)?$' then raise exception 'Career application invalid' using errcode='22023'; end if;
 begin sent_on:=(fields->>'applied_on')::date; exception when others then raise exception 'Career application invalid' using errcode='22023'; end;
 -- UTF-8 length prefixes distinguish null, separators and arbitrary letter text.
 -- The browser checks this digest without echoing the private input fields.
 -- Normalize the instant independently of the connection's timezone.
 select encode(sha256(convert_to(string_agg(case when v is null then '-1:' else octet_length(v)::text||':'||v end,'' order by n),'UTF8')),'hex') into fingerprint
 from unnest(array[actor::text,p_saved_id::text,((extract(epoch from p_saved_updated_at)*1000000)::bigint)::text,
  fields->>'title',fields->>'company',fields->>'url',fields->>'cover_letter',fields->>'cover_letter_url',fields->>'applied_on',fields->>'notes']) with ordinality input(v,n);
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_saved_id::text,0));
 select * into app from public.job_applications where user_id=actor and request_id=p_saved_id;
 if found then
  if app.request_fingerprint is distinct from fingerprint then raise exception 'Career application changed' using errcode='P0002'; end if;
 else
  if sent_on>public.current_owner_day() then raise exception 'Career application invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('own-dashboard-career-listings',0));
  select * into saved from public.saved_job_positions where user_id=actor and id=p_saved_id for update;
  if not found or saved.updated_at<>p_saved_updated_at then raise exception 'Career application changed' using errcode='P0002'; end if;
  insert into public.job_applications(user_id,listing_id,title,company,url,source,location,remote,cover_letter,cover_letter_url,applied_on,notes,request_id,request_fingerprint)
   values(actor,saved.listing_id,fields->>'title',fields->>'company',fields->>'url',saved.source,saved.location,saved.remote,
    fields->>'cover_letter',fields->>'cover_letter_url',sent_on,fields->>'notes',p_saved_id,fingerprint) returning * into app;
  insert into public.job_application_events(user_id,application_id,kind,detail) values(actor,app.id,'applied',sent_on::text);
  delete from public.saved_job_positions where user_id=actor and id=p_saved_id and updated_at=p_saved_updated_at;
  if not found then raise exception 'Career application changed' using errcode='P0002'; end if;
  created:=true;
 end if;
 -- Positive projections exclude fingerprints and future private columns.
 select to_jsonb(a) into app_row from (
  select id,user_id,listing_id,title,company,url,source,location,remote,cover_letter,status,applied_on,notes,created_at,updated_at,
   organization_id,next_follow_up_at,cover_letter_url,request_id,responded_on,response_kind,contact_name,contact_email
  from public.job_applications where user_id=actor and id=app.id
 ) a;
 select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) into event_rows from (
  select id,user_id,application_id,kind,detail,created_at from public.job_application_events
  where user_id=actor and application_id=app.id and kind='applied' and detail=sent_on::text
  order by created_at,id limit 2
 ) e;
 if created and jsonb_array_length(event_rows)<>1 then raise exception 'Career application unconfirmed' using errcode='P0002'; end if;
 result:=jsonb_build_object('ownerId',actor,'requestId',p_saved_id,'fingerprint',fingerprint,'created',created,'row',app_row,
  'event',case when jsonb_array_length(event_rows)=1 then event_rows->0 else null end);
 if octet_length(result::text)>10485760 then raise exception 'Career application exceeded' using errcode='54000'; end if;
 return result;
end $$;
revoke all on function public.record_captured_job_application(uuid,uuid,timestamptz,jsonb) from public,anon,service_role;
grant execute on function public.record_captured_job_application(uuid,uuid,timestamptz,jsonb) to authenticated;
comment on function public.record_captured_job_application(uuid,uuid,timestamptz,jsonb) is
 'Captured owned Saved-version conversion, original-intent retry and explicit application/event receipts. No provider work.';
reset lock_timeout;
