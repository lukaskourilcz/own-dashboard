-- Comment keyword replies for DNESKAi (#160, plan B4).
--
-- The scheduler's `engagement` step polls the comments of each DNESKAi Instagram post published in the last
-- seven days. A comment that matches the post's approved keyword gets one private reply with the approved DM
-- text, and optionally one public reply under it.
--
-- marketing_instagram_comment_replies is the one-reply rule: a row is claimed (unique comment_id) before
-- anything is sent, so a comment can never get a second private reply, even when an answer is lost. It stores
-- Instagram's comment id and media id and nothing about the commenter: no username, no user id, no text.
--
-- marketing_instagram_comment_checks keeps one row per watched publication: where an unfinished pass over the
-- comments continues with the counts of that pass so far, and the counts of the last finished pass for the receipts (B6).
--
-- marketing_accounts gains the per-account switch (off by default) and the code that blocked replies, such as
-- messaging disabled for connected tools. Every table is own-read; only service_role writes.

create table public.marketing_instagram_comment_replies (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 publication_id uuid not null references public.marketing_publications(id) on delete cascade,
 media_id text not null check (media_id ~ '^[0-9]{1,40}$'),
 comment_id text not null unique check (comment_id ~ '^[0-9]{1,40}$'),
 matched_keyword text not null check (matched_keyword ~ '^[A-Z0-9]{1,24}$'),
 status text not null default 'claimed' check (status in ('claimed','sent','failed','uncertain')),
 private_sent_at timestamptz,
 public_status text not null default 'none' check (public_status in ('none','sent','failed','uncertain')),
 public_comment_id text check (public_comment_id is null or public_comment_id ~ '^[0-9]{1,40}$'),
 error_code text check (error_code is null or error_code ~ '^[a-z0-9-]{1,100}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((status='sent')=(private_sent_at is not null))
);
create index marketing_instagram_comment_replies_publication on public.marketing_instagram_comment_replies(user_id,publication_id,created_at desc);
alter table public.marketing_instagram_comment_replies enable row level security;
revoke all on public.marketing_instagram_comment_replies from public,anon,authenticated;
grant select on public.marketing_instagram_comment_replies to authenticated;
grant select,insert,update,delete on public.marketing_instagram_comment_replies to service_role;
create policy owner_read on public.marketing_instagram_comment_replies for select to authenticated using ((select auth.uid())=user_id);

create table public.marketing_instagram_comment_checks (
 publication_id uuid primary key references public.marketing_publications(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 media_id text not null check (media_id ~ '^[0-9]{1,40}$'),
 after_cursor text check (after_cursor is null or length(after_cursor)<=512),
 pass_seen integer not null default 0 check (pass_seen>=0),
 pass_matches integer not null default 0 check (pass_matches>=0),
 pass_skipped_old integer not null default 0 check (pass_skipped_old>=0),
 comments_seen integer not null default 0 check (comments_seen>=0),
 keyword_matches integer not null default 0 check (keyword_matches>=0),
 skipped_old integer not null default 0 check (skipped_old>=0),
 last_checked_at timestamptz,
 last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9-]{1,100}$')
);
create index marketing_instagram_comment_checks_owner on public.marketing_instagram_comment_checks(user_id,last_checked_at);
alter table public.marketing_instagram_comment_checks enable row level security;
revoke all on public.marketing_instagram_comment_checks from public,anon,authenticated;
grant select on public.marketing_instagram_comment_checks to authenticated;
grant select,insert,update,delete on public.marketing_instagram_comment_checks to service_role;
create policy owner_read on public.marketing_instagram_comment_checks for select to authenticated using ((select auth.uid())=user_id);

alter table public.marketing_accounts
 add column engagement_enabled boolean not null default false,
 add column engagement_blocked_code text check (engagement_blocked_code is null or engagement_blocked_code ~ '^[a-z0-9-]{1,100}$'),
 add column engagement_blocked_at timestamptz;

-- A reply or check row belongs to a publication of the same owner, even for service-role writes.
create function public.marketing_comment_publication_owner() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.marketing_publications where id=new.publication_id and user_id=new.user_id) then
    raise exception 'foreign publication';
  end if;
  return new;
end $$;
revoke all on function public.marketing_comment_publication_owner() from public,anon,authenticated;
create trigger marketing_instagram_comment_replies_owner before insert or update on public.marketing_instagram_comment_replies
 for each row execute function public.marketing_comment_publication_owner();
create trigger marketing_instagram_comment_checks_owner before insert or update on public.marketing_instagram_comment_checks
 for each row execute function public.marketing_comment_publication_owner();
