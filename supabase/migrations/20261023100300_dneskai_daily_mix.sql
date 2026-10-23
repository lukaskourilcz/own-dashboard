-- Prepared only; not applied. The DNESKAi daily mix (#156, plan A7): how many news and education posts the owner
-- wants a day and which of the four publishing times are active. One row per owner and project; no row means the
-- default (1 news, 1 education, 08:00 and 17:00). The four times stay the one list in the code (DNESKAI_BRIEF_SLOTS)
-- and in marketing_dneskai_reslot_brief; this row only switches some of them off. The app reads and writes it only
-- with DNESKAI_DAILY_MIX_ENABLED after this file is applied.

create table public.marketing_dneskai_daily_mix (
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 news_per_day integer not null default 1 check(news_per_day between 0 and 4),
 education_per_day integer not null default 1 check(education_per_day between 0 and 4),
 slots text[] not null default array['08:00','17:00'] check(cardinality(slots) between 1 and 4 and slots <@ array['08:00','12:30','17:00','20:00']),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,project_id),
 -- Every target post needs its own time.
 check(news_per_day+education_per_day<=cardinality(slots))
);
alter table public.marketing_dneskai_daily_mix enable row level security;
revoke all on public.marketing_dneskai_daily_mix from public,anon,authenticated;
grant select,insert,update on public.marketing_dneskai_daily_mix to authenticated;
grant all on public.marketing_dneskai_daily_mix to service_role;
create policy owner_read on public.marketing_dneskai_daily_mix for select to authenticated using ((select auth.uid())=user_id);
create policy owner_insert on public.marketing_dneskai_daily_mix for insert to authenticated with check ((select auth.uid())=user_id);
create policy owner_update on public.marketing_dneskai_daily_mix for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
-- The project must belong to the row's owner, as for every DNESKAi collection table.
create trigger collection_ownership before insert or update on public.marketing_dneskai_daily_mix for each row execute function public.marketing_dneskai_ownership();
