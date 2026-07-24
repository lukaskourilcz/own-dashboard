-- Prompts: split the library into the owner's own prompts and a curated
-- "public" set (useful prompts scouted from elsewhere, not written by the
-- owner). is_public = false is the owner's own; true is a curated import. The
-- Prompts page renders the two as separate "Mine" / "Public" subsections.
alter table public.prompts
  add column if not exists is_public boolean not null default false;

create index if not exists prompts_user_public_idx
  on public.prompts (user_id, is_public, created_at desc);
