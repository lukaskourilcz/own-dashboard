-- Two extra DNESKAi plan times (owner decision, 8 November 2026): 10:00 and 14:30 post on Instagram and Threads like
-- 08:00, 12:30 and 17:00. The plan step never fills them by itself; they hold posts placed there on purpose, such as the
-- 17 restyled news posts of 9 to 11 November.
alter table public.marketing_dneskai_plan drop constraint marketing_dneskai_plan_local_time_check;
alter table public.marketing_dneskai_plan add constraint marketing_dneskai_plan_local_time_check
  check (local_time in ('08:00','10:00','12:30','14:30','17:00','20:00'));
