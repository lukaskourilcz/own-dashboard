alter table public.ai_links
 add column if not exists record_type text not null default 'link' check (record_type in ('link','idea')),
 add column if not exists usefulness_rating integer check (usefulness_rating between 1 and 5),
 add column if not exists rating_rationale text,
 add column if not exists project_relevance jsonb not null default '[]'::jsonb check (jsonb_typeof(project_relevance) = 'array'),
 add column if not exists source_urls text[] not null default '{}',
 add column if not exists pricing_evidence text,
 add column if not exists reviewed_at timestamptz;
comment on column public.ai_links.project_relevance is 'Owner-authored repository relevance explanations, not authorization or foreign-record references.';
alter table public.ai_links enable row level security;
alter policy "ai_links insert own" on public.ai_links to authenticated
 with check ((select auth.uid()) = user_id and (category_id is null or exists (select 1 from public.ai_categories c where c.id = category_id and c.user_id = (select auth.uid()))));
alter policy "ai_links update own" on public.ai_links to authenticated
 using ((select auth.uid()) = user_id)
 with check ((select auth.uid()) = user_id and (category_id is null or exists (select 1 from public.ai_categories c where c.id = category_id and c.user_id = (select auth.uid()))));
