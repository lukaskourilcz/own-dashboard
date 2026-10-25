-- Bind complete snapshots to the owner captured by the caller, including an
-- empty result that has no row-level identity to check. Keep legacy one-argument
-- callers and all existing collection/data/RLS contracts unchanged.
set lock_timeout='5s';
create function public.read_owned_collection(p_entity text,p_expected_owner uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if p_expected_owner is null or (select auth.uid()) is distinct from p_expected_owner then
  raise exception 'Captured collection owner unavailable' using errcode='42501';
 end if;
 return public.read_owned_collection(p_entity);
end $$;
revoke all on function public.read_owned_collection(text,uuid) from public,anon,service_role;
grant execute on function public.read_owned_collection(text,uuid) to authenticated;
comment on function public.read_owned_collection(text,uuid) is
 'Captured-owner check before an existing complete RLS snapshot; includes empty results, no write or new table authority.';
reset lock_timeout;
