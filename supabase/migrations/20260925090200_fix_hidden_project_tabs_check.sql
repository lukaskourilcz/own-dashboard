-- Align user_preferences.hidden_project_tabs with the project workspace tabs
-- in src/lib/project-workspace-tabs.ts. The previous check still allowed the
-- removed 'operations' tab and rejected 'scaling' and 'monetization', so
-- hiding either of those in Settings failed to save.

alter table public.user_preferences
  drop constraint if exists user_preferences_hidden_project_tabs_check;

-- Drop ids that are no longer tabs before the stricter check applies.
update public.user_preferences
set hidden_project_tabs = array(
  select tab
  from unnest(hidden_project_tabs) as tab
  where tab = any (array[
    'overview',
    'tasks',
    'activity',
    'communication',
    'repository',
    'finance',
    'knowledge',
    'scaling',
    'monetization'
  ]::text[])
)
where not (
  hidden_project_tabs <@ array[
    'overview',
    'tasks',
    'activity',
    'communication',
    'repository',
    'finance',
    'knowledge',
    'scaling',
    'monetization'
  ]::text[]
);

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
      'knowledge',
      'scaling',
      'monetization'
    ]::text[]
  );
