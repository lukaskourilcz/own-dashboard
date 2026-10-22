-- A successful Story publish acknowledgement is a receipt even when Meta
-- supplies no permanent URL. This exception never applies to Feed or Threads.
create or replace function public.marketing_record_receipt(p_owner uuid,p_publication uuid,p_status text,p_container text,p_media text,p_url text,p_error text)
returns text language plpgsql set search_path='' as $$
declare p public.marketing_publications; r public.marketing_revisions; story boolean;
begin
 if p_status not in ('published','failed','reconciliation') then raise exception 'invalid receipt'; end if;
 select * into p from public.marketing_publications where id=p_publication and user_id=p_owner for update;
 if not found then raise exception 'publication unavailable'; end if;
 if p.status='published' then
  if p_status<>'published' or p.remote_media_id is distinct from p_media then raise exception 'receipt conflict'; end if;
  return p.status;
 end if;
 if p.status not in ('claimed','reconciliation') then raise exception 'publication not claimed'; end if;
 select * into r from public.marketing_revisions where id=p.revision_id and user_id=p_owner for update;
 if not found then raise exception 'revision unavailable'; end if;
 story:=p.platform='instagram' and r.revision->>'format'='story' and r.revision->'account'->>'platform'='instagram';
 if p_status='published' then
  if story then
   if p_media is null or p_media !~ '^[1-9][0-9]{0,99}$' or p_error is not null
    or jsonb_typeof(r.revision->'assets') is distinct from 'array'
    or jsonb_array_length(r.revision->'assets')<>1
    or r.revision->'assets'->0->>'mimeType' is distinct from 'image/jpeg'
    or r.revision->'assets'->0->>'width' is distinct from '1080'
    or r.revision->'assets'->0->>'height' is distinct from '1920'
   then raise exception 'missing Story receipt'; end if;
   if p_url is not null and p_url !~ '^https://' then raise exception 'missing receipt'; end if;
  elsif p_media is null or p_url is null or p_url !~ '^https://' then raise exception 'missing receipt'; end if;
 end if;
 update public.marketing_publications set status=p_status,remote_container_id=p_container,remote_media_id=p_media,remote_url=p_url,error_code=p_error,lease_until=null where id=p.id;
 update public.marketing_revisions set status=p_status where id=r.id and user_id=p_owner;
 insert into public.marketing_events(user_id,revision_id,kind,payload) values(p_owner,r.id,p_status,jsonb_build_object('publicationId',p.id));
 return p_status;
end $$;
revoke all on function public.marketing_record_receipt(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.marketing_record_receipt(uuid,uuid,text,text,text,text,text) to service_role;
