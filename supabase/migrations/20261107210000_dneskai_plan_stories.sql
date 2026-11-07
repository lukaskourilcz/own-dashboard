-- DNESKAi Instagram stories (owner decision, 7 November 2026): every Instagram post of the plan also goes out as a
-- story made from its cover slide, ten minutes after the post. The plan records the story revision and the
-- Instagram revision it was made from, and its approval function also takes the story.

alter table public.marketing_dneskai_plan
  add column story_revision_id uuid references public.marketing_revisions(id) on delete set null,
  add column story_base_revision_id uuid references public.marketing_revisions(id) on delete set null;
create index marketing_dneskai_plan_story_revision on public.marketing_dneskai_plan(story_revision_id) where story_revision_id is not null;

create or replace function marketing_private.dneskai_plan_ownership() returns trigger language plpgsql set search_path='' as $$
begin
 if new.revision_id is not null and not exists(select 1 from public.marketing_revisions where id=new.revision_id and user_id=new.user_id and brand='dneskai') then raise exception 'foreign plan revision'; end if;
 if new.head_revision_id is not null and not exists(select 1 from public.marketing_revisions where id=new.head_revision_id and user_id=new.user_id and brand='dneskai') then raise exception 'foreign plan revision'; end if;
 if new.threads_revision_id is not null and not exists(select 1 from public.marketing_revisions where id=new.threads_revision_id and user_id=new.user_id and brand='dneskai') then raise exception 'foreign plan revision'; end if;
 if new.story_revision_id is not null and not exists(select 1 from public.marketing_revisions where id=new.story_revision_id and user_id=new.user_id and brand='dneskai') then raise exception 'foreign plan revision'; end if;
 if new.topic_id is not null and not exists(select 1 from public.marketing_dneskai_topics where id=new.topic_id and user_id=new.user_id and project_id=new.project_id) then raise exception 'foreign plan topic'; end if;
 new.updated_at:=clock_timestamp();
 return new;
end $$;

create or replace function public.marketing_dneskai_plan_approve(p_owner uuid,p_revision_id uuid,p_expected_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.marketing_revisions; publication uuid; expected_campaign uuid; expected_entry uuid;
begin
 select * into r from public.marketing_revisions where id=p_revision_id and user_id=p_owner and brand='dneskai';
 if not found then raise exception 'revision unavailable'; end if;
 if not exists(select 1 from public.marketing_dneskai_plan p where p.user_id=p_owner and (p.head_revision_id=r.id or p.threads_revision_id=r.id or p.story_revision_id=r.id)) then raise exception 'revision not planned'; end if;
 expected_campaign:=r.campaign_id;
 expected_entry:=r.calendar_entry_id;
 if not public.marketing_revision_campaign_active(r.user_id,expected_campaign,expected_entry) then raise exception 'campaign inactive'; end if;
 select * into r from public.marketing_revisions where id=p_revision_id and user_id=p_owner for update;
 if not found then raise exception 'revision unavailable'; end if;
 if r.campaign_id is distinct from expected_campaign or r.calendar_entry_id is distinct from expected_entry then raise exception 'revision changed'; end if;
 if r.content_hash<>p_expected_hash then raise exception 'revision changed'; end if;
 if r.status not in ('review','approved') or not r.ready then raise exception 'revision not ready'; end if;
 if marketing_private.render_report_blocks(r.render_report) then raise exception 'render blocked'; end if;
 if jsonb_typeof(r.revision->'deck')='object' and (jsonb_typeof(r.revision->'assets') is distinct from 'array'
  or jsonb_array_length(r.revision->'assets')<>jsonb_array_length(r.revision->'deck'->'slides')) then raise exception 'revision not ready'; end if;
 if (r.revision->>'scheduledAt')::timestamptz<=now() then raise exception 'schedule expired'; end if;
 if not public.marketing_sources_valid(r.user_id,r.brand,r.revision,now(),false) then raise exception 'source changed'; end if;
 if not exists(select 1 from public.marketing_accounts a where a.user_id=r.user_id and a.brand=r.brand
   and a.remote_account_id=r.revision->'account'->>'id' and a.platform=r.revision->'account'->>'platform'
   and a.handle=r.revision->'account'->>'handle' and a.verified_at is not null) then raise exception 'account unverified'; end if;
 if r.status='approved' then
  select id into publication from public.marketing_publications where revision_id=r.id and user_id=r.user_id;
  if not found then raise exception 'publication unavailable'; end if;
  return publication;
 end if;
 update public.marketing_revisions set status='approved',approved_at=coalesce(approved_at,now()),approved_hash=content_hash where id=r.id;
 insert into public.marketing_publications(user_id,revision_id,platform,scheduled_at)
 values(r.user_id,r.id,r.revision->'account'->>'platform',(r.revision->>'scheduledAt')::timestamptz)
 on conflict(revision_id,platform) do nothing;
 select id into publication from public.marketing_publications where revision_id=r.id;
 insert into public.marketing_events(user_id,revision_id,kind,payload) values(r.user_id,r.id,'approved',jsonb_build_object('publicationId',publication,'by','dneskai-plan'));
 return publication;
end $$;
revoke all on function public.marketing_dneskai_plan_approve(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_plan_approve(uuid,uuid,text) to service_role;
