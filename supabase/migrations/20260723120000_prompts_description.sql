-- Prompts: add a short human-readable description.
--
-- The Prompts library now shows each prompt's name + a brief description of what
-- it does; the full body is revealed only inside the edit dialog. Existing rows
-- default to an empty description (the card falls back to a short body preview
-- until the owner writes one).
alter table public.prompts
  add column if not exists description text not null default '';
