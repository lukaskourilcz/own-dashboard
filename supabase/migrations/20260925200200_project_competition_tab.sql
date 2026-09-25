-- Allow hiding the project workspace's Competition tab.
--
-- The Competition tab (competitors per project) is a workspace tab in
-- src/lib/project-workspace-tabs.ts, but the check on
-- user_preferences.hidden_project_tabs from
-- 20260925090200_fix_hidden_project_tabs_check.sql predates it, so hiding
-- Competition in Settings would fail to save. The check is recreated with
-- exactly the ten tabs the application defines. Every stored value already
-- satisfies the new check, because it only adds an allowed id.

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
      'scaling',
      'monetization'
    ]::text[]
  );
