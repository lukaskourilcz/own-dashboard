-- New publishing times (owner decision, 8 November 2026, after the Apify research): DNESKAi's 17:00 moves to 19:00 and
-- its Threads-only 20:00 to 21:00, so two posts never go out an hour apart; devShark's Instagram post moves from 12:00 to
-- 16:00 Prague (15:00 UTC in winter). Past rows keep their old times, so the checks accept both.
alter table public.marketing_dneskai_plan drop constraint marketing_dneskai_plan_local_time_check;
alter table public.marketing_dneskai_plan add constraint marketing_dneskai_plan_local_time_check
  check (local_time in ('08:00','10:00','12:30','14:30','17:00','19:00','20:00','21:00'));
alter table public.marketing_dneskai_plan drop constraint marketing_dneskai_plan_check1;
alter table public.marketing_dneskai_plan add constraint marketing_dneskai_plan_check1
  check ((local_time in ('20:00','21:00')) = (not instagram));

alter table public.marketing_dneskai_daily_mix alter column slots set default array['08:00','19:00'];
alter table public.marketing_dneskai_daily_mix drop constraint marketing_dneskai_daily_mix_slots_check;
alter table public.marketing_dneskai_daily_mix add constraint marketing_dneskai_daily_mix_slots_check
  check (cardinality(slots) between 1 and 4 and slots <@ array['08:00','12:30','19:00','21:00']::text[]);

alter table public.marketing_devshark_plan drop constraint marketing_devshark_plan_local_time_check;
alter table public.marketing_devshark_plan add constraint marketing_devshark_plan_local_time_check
  check (local_time in ('12:00','16:00','19:00'));
alter table public.marketing_devshark_plan drop constraint marketing_devshark_plan_check;
alter table public.marketing_devshark_plan add constraint marketing_devshark_plan_check
  check (threads and ((local_time in ('12:00','16:00')) = instagram));

-- Unpublished slots still ahead move. The DNESKAi plan step moves each post's version to its new slot (`move`).
update public.marketing_dneskai_plan set local_time = case local_time when '17:00' then '19:00' else '21:00' end, updated_at = clock_timestamp()
 where local_time in ('17:00','20:00') and status not in ('published','skipped')
   and (date + case local_time when '17:00' then time '17:00' else time '20:00' end) at time zone 'Europe/Prague' > now();

-- A devShark slot already prepared at 12:00 gives up its versions; the publish step prepares them again at 16:00.
with moved as (
  select id, instagram_revision_id, threads_revision_id, story_revision_id from public.marketing_devshark_plan
   where local_time = '12:00' and status in ('planned','ready','approved') and (date + time '12:00') at time zone 'Europe/Prague' > now()
), revisions as (
  select unnest(array[instagram_revision_id, threads_revision_id, story_revision_id]) as id from moved
), cancelled as (
  update public.marketing_publications set status = 'cancelled', error_code = 'owner-moved'
   where status = 'queued' and revision_id in (select id from revisions where id is not null) returning revision_id
), superseded as (
  update public.marketing_revisions set status = 'superseded', approved_at = null, approved_hash = null
   where status in ('review','approved') and id in (select id from revisions where id is not null) returning id
)
update public.marketing_devshark_plan p set local_time = '16:00', status = 'planned', code = null,
  instagram_revision_id = null, threads_revision_id = null, story_revision_id = null, updated_at = clock_timestamp()
 where p.id in (select id from moved);
