-- pg_cron + pg_net call the marketing tick endpoint (#120, owner decision 4 of #110: no n8n timers).
--
-- Two jobs call marketing_private.scheduler_post(kind):
--   marketing-tick-minute  every 5 minutes (UTC)  -> POST {"tick": <uuid>, "kind": "minute"}
--   marketing-tick-daily   02:18 UTC every day    -> POST {"tick": <uuid>, "kind": "daily"}
-- A third job, marketing-cron-history-prune, lives in 20261022000000_marketing_scheduler_retention.sql
-- because production applied this file without it. At 03:43 UTC it deletes cron.job_run_details rows older than
-- 14 days. Supabase runs pg_cron with cron.log_run on and nothing else prunes that table, so the
-- 289 runs a day would otherwise stay forever. It deletes only the history of these three jobs and of
-- jobs that no longer exist (a tick job that was unscheduled and scheduled again gets a new jobid);
-- any other job, an unnamed one (cron.schedule without a name stores jobname null) included, keeps
-- its history.
-- The daily minute sits between two minute ticks: the 02:15 one has finished (the route stops at 60 s)
-- and its 90 s category leases have expired even if it died, and the 02:20 one has not started, so the
-- media purge never finds the media lease held by a minute tick.
-- The request carries the same signature as every other automation call into OwnDashboard
-- (authenticateAutomation): Authorization: Bearer <secret>, X-Marketing-Timestamp (Unix seconds)
-- and X-Marketing-Signature = hex(HMAC-SHA256(secret, timestamp || '.' || body)), where body is
-- exactly the bytes pg_net sends (the jsonb body rendered as text).
--
-- The endpoint URL and the secret live in Supabase Vault and never in this file. Until both exist
-- every job run returns without sending anything. Add them once on the Vault page of the Supabase
-- Dashboard (Integrations, Vault) as marketing_scheduler_url and marketing_scheduler_secret, and
-- rotate by editing the entry there. In the SQL editor use only statements that cannot fail: Postgres
-- logs a failing statement with its full text (log_min_error_statement = error), and a plain
-- vault.create_secret for a name that exists fails, so the secret would land in the database log.
-- A second run of these creates nothing:
--   select vault.create_secret('https://own-dashboard-tau.vercel.app/api/marketing/tick', 'marketing_scheduler_url')
--    where not exists (select 1 from vault.secrets where name = 'marketing_scheduler_url');
--   select vault.create_secret('<the value of MARKETING_SCHEDULER_SECRET>', 'marketing_scheduler_secret')
--    where not exists (select 1 from vault.secrets where name = 'marketing_scheduler_secret');
-- Rotate the secret (Vercel env first, then) by the id of the existing row; without one nothing is called:
--   select vault.update_secret(id, '<new value>') from vault.secrets where name = 'marketing_scheduler_secret';
-- Delete the SQL editor snippet afterwards; it keeps the value in plain text.
-- Stop both ticks (the prune job may keep running; it sends nothing):
--   select cron.unschedule('marketing-tick-minute'); select cron.unschedule('marketing-tick-daily');
-- Stop the prune job too: select cron.unschedule('marketing-cron-history-prune');
-- Start them again by re-running the last block of this file. docs/marketing-scheduling.md has the rest.
--
-- Supabase installs pg_cron in pg_catalog (its tables in the cron schema), pg_net and pgcrypto in
-- the extensions schema (pg_net's functions in the net schema). An engine without one of them, such
-- as the PGlite test database, skips its creation; the tests stand in for the three schemas.

create schema if not exists extensions;
do $extensions$
begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then create extension if not exists pg_cron with schema pg_catalog; end if;
 if exists(select 1 from pg_available_extensions where name='pg_net') then create extension if not exists pg_net with schema extensions; end if;
 if exists(select 1 from pg_available_extensions where name='pgcrypto') then create extension if not exists pgcrypto with schema extensions; end if;
end $extensions$;

-- The canonical string and digest the endpoint verifies; kept separate so a test can compare it
-- with the TypeScript verifier byte for byte.
create or replace function marketing_private.scheduler_signature(p_secret text,p_timestamp text,p_body text) returns text
language sql immutable strict set search_path='' as $$
 select encode(extensions.hmac(convert_to(p_timestamp||'.'||p_body,'UTF8'),convert_to(p_secret,'UTF8'),'sha256'),'hex')
$$;

-- Reads the URL and secret from Vault, builds one signed request and queues it with pg_net (55 s
-- timeout; the route itself stops starting work after 48 s). Returns the pg_net request id, or null
-- when Vault holds no usable configuration. The secret is only ever sent to an https URL whose path
-- is exactly /api/marketing/tick.
create or replace function marketing_private.scheduler_post(p_kind text) returns bigint
language plpgsql security definer set search_path='' as $$
declare v_url text; v_secret text; v_body jsonb; v_timestamp text;
begin
 if p_kind is null or p_kind not in ('minute','daily') then raise exception 'scheduler kind invalid'; end if;
 select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name='marketing_scheduler_url';
 select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name='marketing_scheduler_secret';
 if v_url is null or v_secret is null or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/api/marketing/tick$'
  or char_length(v_secret)<32 or v_secret ~ '\s' then return null; end if;
 v_body:=jsonb_build_object('tick',gen_random_uuid(),'kind',p_kind);
 v_timestamp:=floor(extract(epoch from clock_timestamp()))::bigint::text;
 return net.http_post(
  url:=v_url,
  body:=v_body,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret,
   'X-Marketing-Timestamp',v_timestamp,'X-Marketing-Signature',marketing_private.scheduler_signature(v_secret,v_timestamp,v_body::text)),
  timeout_milliseconds:=55000);
end $$;

revoke all on function marketing_private.scheduler_signature(text,text,text),marketing_private.scheduler_post(text) from public,anon,authenticated,service_role;

-- cron.schedule replaces a job of the same name, so re-running this block is safe.
do $schedule$
begin
 if to_regnamespace('cron') is not null then
  perform cron.schedule('marketing-tick-minute','*/5 * * * *',$command$select marketing_private.scheduler_post('minute')$command$);
  perform cron.schedule('marketing-tick-daily','18 2 * * *',$command$select marketing_private.scheduler_post('daily')$command$);
 end if;
end $schedule$;
