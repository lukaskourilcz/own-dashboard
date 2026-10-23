-- Prepared only; not applied. Topic briefs (#155, plan A6): an approved topic (námět) becomes a brief.
--
-- A news topic already points at the brief row the nightly selection wrote (brief_id); the bridge builds and
-- admits that row as before. An education topic that came from a collected report gets its own brief row in the
-- report's collection run, with the report as its one member, so every guard on the way to a job stays the same:
-- marketing_dneskai_prepare_brief checks the member hash and the evidence ids, marketing_dneskai_admit_brief binds
-- the source head and the calendar entry, marketing_enqueue_job keeps the 8-jobs-per-day limit, and the owner still
-- approves the exact rendered revision. The nightly selection keeps ranks 1 to 4; a topic brief takes 5 to 16.
-- The app writes such rows only with DNESKAI_TOPICS_ENABLED and DNESKAI_TOPIC_BRIEFS_ENABLED after this is applied.

alter table public.marketing_dneskai_briefs add column topic_id uuid references public.marketing_dneskai_topics(id);
create unique index marketing_dneskai_briefs_topic on public.marketing_dneskai_briefs(topic_id) where topic_id is not null;

-- Ranks 1 to 4 stay the night's selection; topic briefs use 5 to 16, and only rows with a topic may.
do $$ declare c text;begin
 for c in select conname from pg_constraint where conrelid='public.marketing_dneskai_briefs'::regclass and contype='c' and pg_get_constraintdef(oid) ~ 'rank >= 1\) AND \(rank <= 4' loop
  execute format('alter table public.marketing_dneskai_briefs drop constraint %I',c);
 end loop;
end $$;
alter table public.marketing_dneskai_briefs add constraint marketing_dneskai_briefs_rank_range check(rank between 1 and 16 and (rank<=4 or topic_id is not null));
