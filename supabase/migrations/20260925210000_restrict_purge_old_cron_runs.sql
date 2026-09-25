-- Take purge_old_cron_runs() away from the API roles.
--
-- 20260724110000_cron_runs.sql created the retention function as SECURITY
-- DEFINER and revoked it from PUBLIC only. On Supabase that is not enough: the
-- platform's default privileges grant EXECUTE on every new function in public
-- directly to anon, authenticated and service_role, and a revoke from PUBLIC
-- leaves those direct grants in place. Production carried
-- {postgres=X, anon=X, authenticated=X, service_role=X}, and the security
-- advisor flagged it (lints 0028 and 0029): anyone, signed in or not, could
-- call /rest/v1/rpc/purge_old_cron_runs and run the delete as the owner.
--
-- The function only deletes runs older than 14 days, so the exposure was an
-- early purge, never a read. Its callers are the pg_cron job, which runs as
-- the owner, and the service role. Revoking a privilege that was never granted
-- is a no-op, so a database without the direct grants ends in the same state,
-- and a second run changes nothing.

revoke all on function public.purge_old_cron_runs() from public, anon, authenticated;
grant execute on function public.purge_old_cron_runs() to service_role;
