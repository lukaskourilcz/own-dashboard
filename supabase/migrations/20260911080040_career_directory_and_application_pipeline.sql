create table public.career_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  url text not null check (url ~ '^https://[^/[:space:]]+'),
  category text not null default 'Product' check (category in ('Product','Agency','Finance','Commerce','Enterprise')),
  country text not null default '',
  notes text not null default '',
  checked_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,name)
);
alter table public.career_companies enable row level security;
revoke all on public.career_companies from anon, authenticated;
grant select,insert,update,delete on public.career_companies to authenticated,service_role;
create policy "career companies select own" on public.career_companies for select to authenticated using ((select auth.uid())=user_id);
create policy "career companies insert own" on public.career_companies for insert to authenticated with check ((select auth.uid())=user_id);
create policy "career companies update own" on public.career_companies for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "career companies delete own" on public.career_companies for delete to authenticated using ((select auth.uid())=user_id);

alter table public.saved_job_positions add column cover_letter_url text,
  add column readiness text not null default 'draft' check (readiness in ('draft','ready','needs_review')),
  add constraint saved_letter_url check (cover_letter_url is null or cover_letter_url ~ '^https://(docs\.google\.com/document/d/|drive\.google\.com/file/d/)[A-Za-z0-9_-]+');
alter table public.job_applications add column cover_letter_url text,
  add column request_id uuid,
  add column responded_on date,
  add column response_kind text check (response_kind in ('positive','negative','neutral')),
  add constraint application_letter_url check (cover_letter_url is null or cover_letter_url ~ '^https://(docs\.google\.com/document/d/|drive\.google\.com/file/d/)[A-Za-z0-9_-]+'),
  add constraint application_response_date check (responded_on is null or responded_on >= applied_on),
  add constraint application_response_pair check ((responded_on is null) = (response_kind is null)),
  add constraint application_request_unique unique(user_id,request_id);

-- One transaction records the application, its history, and removal from the queue.
-- A repeated request returns the original snapshot, including after queue removal.
create function public.record_job_application(p_request_id uuid, p_saved_id uuid, p_payload jsonb)
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
  if sent_on is null or sent_on > current_date then raise exception 'Invalid application date'; end if;
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

create function public.update_job_application_progress(p_id uuid,p_status text,p_responded_on date,p_response_kind text,p_follow_up_at timestamptz,p_notes text)
returns public.job_applications language plpgsql security invoker set search_path = '' as $$
declare actor uuid:=auth.uid(); old_row public.job_applications; result public.job_applications;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into old_row from public.job_applications where id=p_id and user_id=actor for update;
  if not found then raise exception 'Application not found' using errcode='P0002'; end if;
  if p_responded_on > current_date then raise exception 'Response cannot be in the future'; end if;
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
