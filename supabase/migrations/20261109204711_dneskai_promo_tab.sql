-- Add the Promo slide tab to the existing workspace preferences.
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
      'dneskai-today',
      'dneskai-promo',
      'devshark-studio'
    ]::text[]
  );
