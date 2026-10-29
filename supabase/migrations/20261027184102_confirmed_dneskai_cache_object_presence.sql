-- Read-only proof for the two immutable DNESKAi cache paths; HTTP errors cannot establish absence.
create function public.read_owned_dneskai_cache_object(p_owner uuid,p_kind text,p_key text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare bucket text; object_name text; matches integer;
begin
 if current_user<>'service_role' then raise exception 'Cache object unavailable' using errcode='42501';end if;
 if p_owner is null or p_kind is null or p_kind not in('slide','reel') or p_key is null or p_key !~ '^[a-f0-9]{64}$' then
  raise exception 'Cache object invalid' using errcode='22023';end if;
 bucket:=case p_kind when 'slide' then 'marketing-assets' else 'marketing-reels' end;
 object_name:=p_owner::text||'/marketing/dneskai/'||case p_kind when 'slide' then 'slides/' else 'reels/' end||p_key||case p_kind when 'slide' then '.jpg' else '.mp4' end;
 if not exists(select 1 from storage.buckets where id=bucket and public=false) then
  raise exception 'Cache object unavailable' using errcode='40001';end if;
 select count(*)::integer into matches from storage.objects where bucket_id=bucket and name=object_name;
 if matches>1 then raise exception 'Cache object unavailable' using errcode='40001';end if;
 return jsonb_build_object('ownerId',p_owner,'kind',p_kind,'key',p_key,'state',case when matches=1 then 'present' else 'absent' end);
end $$;
revoke all on function public.read_owned_dneskai_cache_object(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.read_owned_dneskai_cache_object(uuid,text,text) to service_role;
comment on function public.read_owned_dneskai_cache_object(uuid,text,text) is
 'Service-only stable exact owned slide/Reel presence proof in existing private buckets; no bytes, metadata, credentials, writes or policy changes.';
