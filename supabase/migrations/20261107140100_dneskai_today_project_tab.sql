-- Allow hiding the DNESKAi "Dnes a zítra" tab (owner decision, 7 November 2026).
--
-- The check is recreated with exactly PROJECT_TAB_IDS in src/lib/project-workspace-tabs.ts: the fifteen ids from
-- 20261021124712_dneskai_hideable_project_tabs.sql followed by 'dneskai-today'. No row is rewritten: every stored
-- value satisfied the previous check, and the new check only adds an allowed id.

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
      'dneskai-costs',
      'dneskai-today'
    ]::text[]
  );
