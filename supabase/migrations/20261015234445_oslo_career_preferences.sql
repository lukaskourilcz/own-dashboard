-- Additive preference. Existing own-only policies and grants remain in force.
alter table public.user_preferences
  add column if not exists show_czech_career boolean not null default false;

comment on column public.user_preferences.show_czech_career is
  'Opt in to Czech career sources and content alongside the default Oslo search.';
