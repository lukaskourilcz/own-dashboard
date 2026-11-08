-- Comment replies carry no signature (owner decision, 8 November 2026): a drafted reply, and what is sent, never
-- appends "— Lukáš" or any sign-off. The per-reply signature column is removed; nothing writes or reads it.
alter table public.marketing_comment_reply_drafts drop column if exists signature;
