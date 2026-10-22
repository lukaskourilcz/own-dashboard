-- Allow hiding the four DNESKAi project workspace tabs.
--
-- The DNESKAi project shows For review today, Calendar, Published and Errors
-- and costs (#119). Settings now lists them with the other project tabs, so
-- user_preferences.hidden_project_tabs has to accept their ids. The check is
-- recreated with the eleven tabs from
-- 20261013165236_marketing_dneskai_collection.sql followed by the four
-- DNESKAi ids, exactly PROJECT_TAB_IDS in src/lib/project-workspace-tabs.ts.
-- No row is rewritten: every stored value satisfied the previous check, and
-- the new check only adds allowed ids.

alter table public.user_preferences
  drop constraint if exists user_preferences_hidden_project_tabs_check;

alter table public.user_preferences
  add constraint user_preferences_hidden_project_tabs_check
  check (
    hidden_project_tabs <@ array[
      'overview',
      'tasks',
      'activity',
      'communication',
      'repository',
      'finance',
      'competition',
      'knowledge',
      'sources',
      'scaling',
      'monetization',
      'dneskai-review',
      'dneskai-calendar',
      'dneskai-published',
      'dneskai-costs'
    ]::text[]
  );
