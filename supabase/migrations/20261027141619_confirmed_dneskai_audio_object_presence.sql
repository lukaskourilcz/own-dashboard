-- Read-only proof for one owned audio path. Storage HTTP errors alone do not prove absence.
create function public.read_owned_dneskai_audio_object(p_owner uuid,p_id uuid,p_content_type text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare extension text; matches integer;
begin
 if current_user<>'service_role' then raise exception 'Audio object unavailable' using errcode='42501';end if;
 if p_owner is null or p_id is null or p_content_type is null then raise exception 'Audio object invalid' using errcode='22023';end if;
 extension:=case p_content_type when 'audio/mpeg' then 'mp3' when 'audio/mp4' then 'm4a' when 'audio/x-m4a' then 'm4a'
  when 'audio/aac' then 'aac' when 'audio/wav' then 'wav' when 'audio/x-wav' then 'wav' when 'audio/ogg' then 'ogg' else null end;
 if extension is null then raise exception 'Audio object invalid' using errcode='22023';end if;
 if not exists(select 1 from storage.buckets where id='marketing-audio' and public=false) then
  raise exception 'Audio object unavailable' using errcode='40001';end if;
 select count(*)::integer into matches from storage.objects
  where bucket_id='marketing-audio' and name=p_owner::text||'/'||p_id::text||'.'||extension;
 if matches>1 then raise exception 'Audio object unavailable' using errcode='40001';end if;
 return jsonb_build_object('ownerId',p_owner,'id',p_id,'contentType',p_content_type,'state',case when matches=1 then 'present' else 'absent' end);
end $$;
revoke all on function public.read_owned_dneskai_audio_object(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.read_owned_dneskai_audio_object(uuid,uuid,text) to service_role;
comment on function public.read_owned_dneskai_audio_object(uuid,uuid,text) is
 'Service-only stable owned-path presence proof in an existing private bucket; no object data, credentials or writes.';
