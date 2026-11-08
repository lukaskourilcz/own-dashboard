-- Which look an imported HeyDarlink ambient picture had (owner decision, 8 November 2026): `claude` for the paid vision
-- gate, `owner-reviewed` for a picture uploaded under `reviewed/`, which the owner's agent looked at before upload.
alter table public.heydarlink_ambient_imports add column gate text not null default 'claude' check (gate in ('claude','owner-reviewed'));
