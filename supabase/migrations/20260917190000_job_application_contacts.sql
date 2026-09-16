-- Structured contact fields on a job application.
--
-- The recruiter or hiring manager you are actually talking to has lived in the
-- free-text notes until now, which means it cannot be shown on a card, exported
-- as a column, or told apart from the rest of the note. `client_opportunities`
-- already models the same pair, so these two columns bring the career pipeline
-- in line with it rather than inventing a second shape.
--
-- Columns only: no table, no policy, no grant and no function. The four
-- own-only `job_applications` policies and the existing grants already cover
-- new columns, so RLS is unchanged. The checks mirror `career_companies`:
-- a bounded length, and an address that at least has one @ and a dot in the
-- domain — validation, not verification.
--
-- Until this migration runs, PostgREST does not return the two keys at all and
-- the progress dialog says so instead of offering fields that cannot save.

alter table public.job_applications
  add column if not exists contact_name text
    check (contact_name is null or length(btrim(contact_name)) between 1 and 200),
  add column if not exists contact_email text
    check (contact_email is null or contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

comment on column public.job_applications.contact_name is 'Recruiter or hiring-manager name for this application. Owner-entered; never imported from a job board.';
comment on column public.job_applications.contact_email is 'Contact address for this application. Format-checked only — no address is verified or contacted by the application.';
