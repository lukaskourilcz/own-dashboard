-- Comment inbox with owner-drafted replies for DNESKAi and devShark, on Instagram and Threads (owner request,
-- 8 November 2026). This supersedes the keyword-only path of #160 for accounts whose inbox is switched on: the
-- captured comment, its author and its text are stored so the owner can read them, a short reply is drafted in the
-- owner's voice, and nothing is sent until the owner confirms with one click (see docs/ai-and-privacy.md, updated
-- in this change).
--
--   marketing_comments            one captured comment (text + author), unique per (user, platform, comment_id).
--   marketing_comment_reply_drafts the prepared reply for a comment; one per comment; never auto-sent.
--   marketing_comment_style_samples a small, refreshable sample of the owner's own writing per brand, used only to
--                                  steer the drafting voice.
--   marketing_accounts.comment_inbox_enabled  per-account switch, off by default.
--
-- Every table is own-read for the owner; only service_role writes, through the engagement capture and the
-- send path. Ownership is re-checked on write by the triggers below, even for service-role writes.

create table public.marketing_comments (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null references public.marketing_accounts(id) on delete cascade,
 publication_id uuid references public.marketing_publications(id) on delete set null,
 brand text not null check (brand in ('dneskai','devshark')),
 platform text not null check (platform in ('instagram','threads')),
 media_id text not null check (media_id ~ '^[0-9]{1,40}$'),
 comment_id text not null check (comment_id ~ '^[0-9]{1,40}$'),
 parent_comment_id text check (parent_comment_id is null or parent_comment_id ~ '^[0-9]{1,40}$'),
 author_username text check (author_username is null or length(author_username) <= 80),
 author_remote_id text check (author_remote_id is null or author_remote_id ~ '^[0-9]{1,40}$'),
 body text not null check (length(body) <= 3000),
 permalink text check (permalink is null or length(permalink) <= 600),
 commented_at timestamptz,
 status text not null default 'new' check (status in ('new','drafted','skipped','replied','flagged')),
 flagged_reason text check (flagged_reason is null or flagged_reason ~ '^[a-z0-9-]{1,40}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (user_id, platform, comment_id)
);
create index marketing_comments_owner on public.marketing_comments(user_id, status, created_at desc);
create index marketing_comments_account on public.marketing_comments(account_id, created_at desc);
alter table public.marketing_comments enable row level security;
revoke all on public.marketing_comments from public,anon,authenticated;
grant select on public.marketing_comments to authenticated;
grant select,insert,update,delete on public.marketing_comments to service_role;
create policy owner_read on public.marketing_comments for select to authenticated using ((select auth.uid())=user_id);

create table public.marketing_comment_reply_drafts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 comment_row_id uuid not null unique references public.marketing_comments(id) on delete cascade,
 draft_text text not null check (length(draft_text) <= 1000),
 edited_text text check (edited_text is null or length(edited_text) <= 1000),
 signature text not null default '' check (length(signature) <= 80),
 model text check (model is null or length(model) <= 80),
 prompt_version text check (prompt_version is null or length(prompt_version) <= 40),
 status text not null default 'draft' check (status in ('draft','edited','sending','sent','failed','discarded')),
 sent_at timestamptz,
 remote_reply_id text check (remote_reply_id is null or remote_reply_id ~ '^[0-9]{1,40}$'),
 error_code text check (error_code is null or error_code ~ '^[a-z0-9-]{1,100}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((status='sent') = (sent_at is not null))
);
create index marketing_comment_reply_drafts_owner on public.marketing_comment_reply_drafts(user_id, status, created_at desc);
alter table public.marketing_comment_reply_drafts enable row level security;
revoke all on public.marketing_comment_reply_drafts from public,anon,authenticated;
grant select on public.marketing_comment_reply_drafts to authenticated;
grant select,insert,update,delete on public.marketing_comment_reply_drafts to service_role;
create policy owner_read on public.marketing_comment_reply_drafts for select to authenticated using ((select auth.uid())=user_id);

create table public.marketing_comment_style_samples (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 brand text not null check (brand in ('dneskai','devshark')),
 samples jsonb not null default '[]'::jsonb check (jsonb_typeof(samples) = 'array'),
 source text check (source is null or length(source) <= 200),
 refreshed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (user_id, brand)
);
alter table public.marketing_comment_style_samples enable row level security;
revoke all on public.marketing_comment_style_samples from public,anon,authenticated;
grant select on public.marketing_comment_style_samples to authenticated;
grant select,insert,update,delete on public.marketing_comment_style_samples to service_role;
create policy owner_read on public.marketing_comment_style_samples for select to authenticated using ((select auth.uid())=user_id);

alter table public.marketing_accounts
 add column comment_inbox_enabled boolean not null default false;

-- A captured comment belongs to an account of the same owner, and its publication (when set) to that owner too.
create function public.marketing_comment_account_owner() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.marketing_accounts where id=new.account_id and user_id=new.user_id) then
    raise exception 'foreign account';
  end if;
  if new.publication_id is not null
     and not exists(select 1 from public.marketing_publications where id=new.publication_id and user_id=new.user_id) then
    raise exception 'foreign publication';
  end if;
  return new;
end $$;
revoke all on function public.marketing_comment_account_owner() from public,anon,authenticated;
create trigger marketing_comments_owner before insert or update on public.marketing_comments
 for each row execute function public.marketing_comment_account_owner();

-- A reply draft belongs to a captured comment of the same owner.
create function public.marketing_comment_reply_owner() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.marketing_comments where id=new.comment_row_id and user_id=new.user_id) then
    raise exception 'foreign comment';
  end if;
  return new;
end $$;
revoke all on function public.marketing_comment_reply_owner() from public,anon,authenticated;
create trigger marketing_comment_reply_drafts_owner before insert or update on public.marketing_comment_reply_drafts
 for each row execute function public.marketing_comment_reply_owner();
