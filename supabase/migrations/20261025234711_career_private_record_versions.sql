-- Private Career editors need a database version for stale-write predicates.
-- Do not rewrite existing history or infer missing workplace evidence.
set lock_timeout='5s';
alter table public.saved_job_positions add constraint saved_job_positions_finite_version
 check(isfinite(updated_at)) not valid;
alter table public.saved_job_positions validate constraint saved_job_positions_finite_version;
alter table public.job_applications add constraint job_applications_finite_version
 check(isfinite(updated_at)) not valid;
alter table public.job_applications validate constraint job_applications_finite_version;
alter table public.cover_letter_templates add constraint cover_letter_templates_finite_version
 check(isfinite(updated_at)) not valid;
alter table public.cover_letter_templates validate constraint cover_letter_templates_finite_version;

create function public.career_private_version_touch() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 return new;
end $$;
revoke all on function public.career_private_version_touch() from public,anon,authenticated,service_role;
create trigger career_private_version_touch before update on public.saved_job_positions
 for each row execute function public.career_private_version_touch();
create trigger career_private_version_touch before update on public.job_applications
 for each row execute function public.career_private_version_touch();
create trigger career_private_version_touch before update on public.cover_letter_templates
 for each row execute function public.career_private_version_touch();
comment on function public.career_private_version_touch() is
 'Finite monotonic update versions for permitted private Career writers; no new ownership policy or record.';
reset lock_timeout;
