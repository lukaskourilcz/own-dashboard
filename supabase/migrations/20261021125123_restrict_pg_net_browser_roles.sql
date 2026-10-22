-- Installing pg_net 0.20 runs Supabase's issue_pg_net_access trigger, which lets anon and authenticated
-- call net.http_post and net.http_get. Nothing in OwnDashboard needs a browser role to send HTTP from
-- the database: the scheduler queues its request through marketing_private.scheduler_post, a security
-- definer function owned by postgres. Revoking keeps the net schema from becoming an SSRF primitive
-- should it ever be exposed through the API.
--
-- Recorded in production on 2026-10-21 and added here on 2026-10-22 so the repository and production
-- history list the same versions. In production it changed nothing: Supabase grants net.http_post to
-- PUBLIC as supabase_admin, which the postgres role cannot revoke. The guard keeps a database without
-- pg_net (the PGlite tests) from failing on the missing schema.
do $net$
begin
 if to_regnamespace('net') is not null then
  revoke execute on all functions in schema net from anon, authenticated;
  revoke usage on schema net from anon, authenticated;
 end if;
end $net$;
