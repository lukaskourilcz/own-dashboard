-- One bounded, service-only transition replaces the racing alert read/insert.
-- Raw vendor options/messages are never stored. Legacy name-keyed alerts are
-- deliberately untouched: a later monitor name cannot prove their identity.
set lock_timeout='5s';
grant usage on schema dashboard_private to service_role;
create table dashboard_private.uptime_kuma_monitors(
 user_id uuid not null references auth.users(id) on delete cascade,
 monitor_id bigint not null check(monitor_id between 1 and 9007199254740991),
 monitor_name text not null check(length(monitor_name) between 1 and 200),
 observed_at timestamptz not null check(isfinite(observed_at)),
 status smallint not null check(status in(0,1)),
 primary key(user_id,monitor_id)
);
alter table dashboard_private.uptime_kuma_monitors enable row level security;
revoke all on dashboard_private.uptime_kuma_monitors from public,anon,authenticated,service_role;
grant select,insert,update on dashboard_private.uptime_kuma_monitors to service_role;
-- Match and resolve all open alerts for this stable identity, without scanning
-- every notification. No uniqueness/backfill is imposed on historical records.
create index notifications_uptime_open_idx on public.notifications(user_id,source_id)
 where kind='cron_heartbeat_down' and source_type='cron' and dismissed_at is null;
grant insert on public.cron_runs to service_role;

create function public.record_uptime_kuma_event(p_owner uuid,p_monitor_id bigint,p_name text,p_observed_at timestamptz,p_status integer)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
 previous dashboard_private.uptime_kuma_monitors;
 saved dashboard_private.uptime_kuma_monitors;
 source_key text; outcome text:='unchanged'; resolved integer:=0;
begin
 if current_user<>'service_role' then raise exception 'Heartbeat unavailable' using errcode='42501'; end if;
 if p_owner is null or p_monitor_id is null or p_monitor_id not between 1 and 9007199254740991
  or p_name is null or length(p_name) not between 1 and 200 or p_name<>btrim(p_name) or p_name ~ '[[:cntrl:]]'
  or p_observed_at is null or not isfinite(p_observed_at) or p_observed_at>clock_timestamp()+interval '5 minutes'
  or p_status is null or p_status not in(0,1) then raise exception 'Heartbeat invalid' using errcode='22023'; end if;
 -- Reserve even the first event before checking/creating its state row.
 perform pg_advisory_xact_lock(hashtextextended('uptime-kuma:'||p_owner::text||':'||p_monitor_id::text,0));
 select * into previous from dashboard_private.uptime_kuma_monitors where user_id=p_owner and monitor_id=p_monitor_id for update;
 if found and p_observed_at<=previous.observed_at then
  saved:=previous;
  if p_observed_at<previous.observed_at or p_status<>previous.status then outcome:='stale'; end if;
 else
  insert into dashboard_private.uptime_kuma_monitors(user_id,monitor_id,monitor_name,observed_at,status)
   values(p_owner,p_monitor_id,p_name,p_observed_at,p_status)
   on conflict(user_id,monitor_id) do update set monitor_name=excluded.monitor_name,observed_at=excluded.observed_at,status=excluded.status
   returning * into saved;
  source_key:='uptime-kuma:'||p_monitor_id::text;
  if p_status=0 and (previous.user_id is null or previous.status<>0) then
   insert into public.notifications(user_id,kind,source_type,source_id,title,body,action_url)
    values(p_owner,'cron_heartbeat_down','cron',source_key,p_name||' stopped reporting','Its monitor received no heartbeat in time.','/projects');
   insert into public.cron_runs(user_id,name,endpoint,status,source,detail,fired_at)
    values(p_owner,p_name,'uptime-kuma','failure','external','Its monitor received no heartbeat in time.',p_observed_at);
   outcome:='recorded';
  elsif p_status=1 and previous.status=0 then
   update public.notifications set dismissed_at=clock_timestamp()
    where user_id=p_owner and kind='cron_heartbeat_down' and source_type='cron' and source_id=source_key and dismissed_at is null;
   get diagnostics resolved=row_count;
   if resolved>0 then
    insert into public.notifications(user_id,kind,source_type,source_id,title,body,action_url)
     values(p_owner,'cron_heartbeat_up','cron',source_key,p_name||' is reporting again','Its monitor received a heartbeat.','/projects');
    outcome:='recorded';
   end if;
  end if;
 end if;
 return jsonb_build_object('ownerId',saved.user_id,'monitorId',saved.monitor_id,'observedAt',saved.observed_at,'status',saved.status,'outcome',outcome);
end $$;
revoke all on function public.record_uptime_kuma_event(uuid,bigint,text,timestamptz,integer) from public,anon,authenticated,service_role;
grant execute on function public.record_uptime_kuma_event(uuid,bigint,text,timestamptz,integer) to service_role;
