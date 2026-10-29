-- Prepare captured track toggles without changing existing ownership or write grants.
-- The existing API/browser adoption follows separately; no historical field is rewritten.
set lock_timeout='5s';
alter table public.marketing_audio_tracks add constraint marketing_audio_tracks_finite_version
 check(isfinite(updated_at) and extract(year from updated_at) between 1 and 9999) not valid;
alter table public.marketing_audio_tracks validate constraint marketing_audio_tracks_finite_version;

create function public.dneskai_audio_version_touch() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 return new;
end $$;
revoke all on function public.dneskai_audio_version_touch() from public,anon,authenticated,service_role;
create trigger dneskai_audio_version_touch before update on public.marketing_audio_tracks
 for each row execute function public.dneskai_audio_version_touch();

create function public.toggle_owned_dneskai_audio_track(p_owner uuid,p_id uuid,p_expected_at timestamptz,p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
 before_row public.marketing_audio_tracks%rowtype;
 written_row public.marketing_audio_tracks%rowtype;
 after_row public.marketing_audio_tracks%rowtype;
 intent jsonb;
begin
 if current_user<>'service_role' then raise exception 'Audio toggle unavailable' using errcode='42501';end if;
 if p_owner is null or p_id is null or p_expected_at is null or not isfinite(p_expected_at)
  or extract(year from p_expected_at) not between 1 and 9999 or p_enabled is null then
  raise exception 'Audio toggle invalid' using errcode='22023';end if;
 intent:=jsonb_build_object('ownerId',p_owner,'id',p_id,'expectedVersion',p_expected_at,'requestedEnabled',p_enabled);
 select * into before_row from public.marketing_audio_tracks where id=p_id and user_id=p_owner for update;
 if not found then return intent||jsonb_build_object('kind','absent','updatedAt',null);end if;
 if before_row.updated_at<>p_expected_at then
  return intent||jsonb_build_object('kind','changed','updatedAt',before_row.updated_at);
 end if;
 update public.marketing_audio_tracks set enabled=p_enabled where id=p_id and user_id=p_owner and updated_at=p_expected_at
 returning * into written_row;
 if not found then raise exception 'Audio toggle unconfirmed' using errcode='40001';end if;
 -- RETURNING alone cannot confirm a later trigger's final persisted row.
 select * into after_row from public.marketing_audio_tracks where id=p_id and user_id=p_owner;
 if not found or after_row.enabled is distinct from p_enabled or not isfinite(after_row.updated_at) or after_row.updated_at<=p_expected_at
  or after_row is distinct from written_row
  or (to_jsonb(after_row)-'enabled'-'updated_at') is distinct from (to_jsonb(before_row)-'enabled'-'updated_at') then
  raise exception 'Audio toggle unconfirmed' using errcode='40001';end if;
 return intent||jsonb_build_object('kind','saved','updatedAt',after_row.updated_at);
end $$;
revoke all on function public.toggle_owned_dneskai_audio_track(uuid,uuid,timestamptz,boolean) from public,anon,authenticated,service_role;
grant execute on function public.toggle_owned_dneskai_audio_track(uuid,uuid,timestamptz,boolean) to service_role;
comment on function public.toggle_owned_dneskai_audio_track(uuid,uuid,timestamptz,boolean) is
 'Service-only captured-version owner toggle with a positive intent receipt; uncertain retries require a fresh read.';
