alter table public.freelance_platforms add column resources_url text check (resources_url ~ '^https://');
