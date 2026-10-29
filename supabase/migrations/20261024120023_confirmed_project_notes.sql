-- Field-scoped note compare-and-save. Unrelated project metadata may change;
-- another note edit may not be silently replaced. Hashes avoid resending the
-- old document or returning either document in the compact receipt.
create function public.save_project_notes(p_id uuid,p_expected_hash text,p_notes text) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
  actor uuid := (select auth.uid());
  source public.projects; saved public.projects;
  source_hash text; desired_hash text; outcome text := 'saved';
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_expected_hash is null or p_expected_hash !~ '^[0-9a-f]{64}$'
    or p_notes is null or octet_length(p_notes)>1048576 then
    raise exception 'Invalid project notes' using errcode='22023';
  end if;
  select * into source from public.projects where id=p_id and user_id=actor for update;
  if not found then raise exception 'Project not found' using errcode='42501'; end if;
  source_hash := encode(sha256(convert_to(source.notes,'UTF8')),'hex');
  desired_hash := encode(sha256(convert_to(p_notes,'UTF8')),'hex');
  saved := source;
  if source_hash=desired_hash then
    -- Identical retries do not create another write or version.
    null;
  elsif source_hash<>p_expected_hash then
    outcome := 'conflict';
  else
    update public.projects set notes=p_notes,
      updated_at=greatest(clock_timestamp(),source.updated_at+interval '1 millisecond')
    where id=p_id and user_id=actor returning * into saved;
    if not found or saved.notes is distinct from p_notes or saved.updated_at<=source.updated_at
      or (to_jsonb(saved)-array['notes','updated_at']) is distinct from (to_jsonb(source)-array['notes','updated_at']) then
      raise exception 'Project notes save not confirmed' using errcode='40001';
    end if;
  end if;
  return jsonb_build_object('kind',outcome,'id',source.id,'user_id',actor,
    'notes_hash',case when outcome='saved' then desired_hash else source_hash end,
    'source_notes_hash',source_hash,'source_updated_at',source.updated_at,'updated_at',saved.updated_at);
end $$;
revoke all on function public.save_project_notes(uuid,text,text) from public,anon,service_role;
grant execute on function public.save_project_notes(uuid,text,text) to authenticated;
comment on function public.save_project_notes(uuid,text,text) is
  'Own-only field-scoped SHA-256 compare-and-save; 1 MiB new UTF-8 text, compact hash/version receipts, no-op identical retry, conflicts do not write.';
