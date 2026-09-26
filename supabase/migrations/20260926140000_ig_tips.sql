-- IG TIPS: the library's ideas (ai_links rows with record_type 'idea') move
-- out of Links into their own navigation section, grouped by topic. Each tip
-- carries its topic group and a plain-language summary that its card shows.
-- The stored description is left as it is: it stays the research notes
-- behind the tip, so nothing an earlier import wrote is lost.
--
-- Additive only: two nullable columns and their checks. No table, policy,
-- grant or function changes; the four own-only ai_links policies cover the
-- new columns unchanged. The group list matches TIP_GROUPS in
-- src/lib/ig-tips.ts.

alter table public.ai_links
  add column if not exists tip_group text,
  add column if not exists tip_summary text;

alter table public.ai_links
  drop constraint if exists ai_links_tip_group_check;
alter table public.ai_links
  add constraint ai_links_tip_group_check
  check (tip_group is null or tip_group in (
    'content',
    'formats',
    'reach',
    'growth',
    'monetization',
    'research',
    'design',
    'ai',
    'operations'
  ));

alter table public.ai_links
  drop constraint if exists ai_links_tip_summary_length_check;
alter table public.ai_links
  add constraint ai_links_tip_summary_length_check
  check (tip_summary is null or char_length(tip_summary) <= 2000);

comment on column public.ai_links.tip_group is
  'IG TIPS topic group of an idea: content, formats, reach, growth, monetization, research, design, ai or operations. Null means ungrouped.';
comment on column public.ai_links.tip_summary is
  'Plain explanation an IG TIPS card shows: what the tip is and how to use it. The description keeps the research notes.';
