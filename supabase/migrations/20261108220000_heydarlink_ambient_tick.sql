-- The HeyDarlink ambient batches get their own tick (8 November 2026): the marketing minute tick spends its budget on
-- DNESKAi and left no time for a frame. This posts `{ tick, kind: 'minute' }` to /api/heydarlink/ambient/tick, signed
-- exactly like marketing_private.scheduler_post, at the base URL the scheduler already uses.
create function marketing_private.heydarlink_ambient_post()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text; v_body jsonb; v_timestamp text;
begin
 select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'marketing_scheduler_url';
 select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'marketing_scheduler_secret';
 if v_url is null or v_secret is null or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/api/marketing/tick$'
  or char_length(v_secret) < 32 or v_secret ~ '\s' then return null; end if;
 v_url := regexp_replace(v_url, '/api/marketing/tick$', '/api/heydarlink/ambient/tick');
 v_body := jsonb_build_object('tick', gen_random_uuid(), 'kind', 'minute');
 v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
 return net.http_post(
  url := v_url,
  body := v_body,
  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret,
   'X-Marketing-Timestamp', v_timestamp, 'X-Marketing-Signature', marketing_private.scheduler_signature(v_secret, v_timestamp, v_body::text)),
  timeout_milliseconds := 58000);
end $$;
revoke all on function marketing_private.heydarlink_ambient_post() from public, anon, authenticated;

-- Two and a half minutes after each marketing tick, so the two never start together.
select cron.schedule('heydarlink-ambient-tick', '2-59/5 * * * *', 'select marketing_private.heydarlink_ambient_post()');
