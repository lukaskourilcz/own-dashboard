-- devShark publishing (owner decision, 7 November 2026). A plan slot holds an approved concept; the scheduler renders
-- it, stores one revision per channel (the Instagram carousel, its Threads twin or the Threads-only post, and the
-- Instagram story from the cover) and approves them for the owner, who approved the concept in the studio. The
-- approval function takes only a revision a devShark plan slot names.

alter table public.marketing_devshark_plan
  add column instagram_revision_id uuid references public.marketing_revisions(id) on delete set null,
  add column threads_revision_id uuid references public.marketing_revisions(id) on delete set null,
  add column story_revision_id uuid references public.marketing_revisions(id) on delete set null;

create function public.marketing_devshark_plan_approve(p_owner uuid,p_revision_id uuid,p_expected_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.marketing_revisions; publication uuid;
begin
 select * into r from public.marketing_revisions where id=p_revision_id and user_id=p_owner and brand='devshark' for update;
 if not found then raise exception 'revision unavailable'; end if;
 if not exists(select 1 from public.marketing_devshark_plan p join public.marketing_devshark_drafts d on d.id=p.draft_id
   where p.user_id=p_owner and d.status in ('planned','published') and r.id in (p.instagram_revision_id,p.threads_revision_id,p.story_revision_id)) then raise exception 'revision not planned'; end if;
 if r.content_hash<>p_expected_hash then raise exception 'revision changed'; end if;
 if r.status not in ('review','approved') or not r.ready then raise exception 'revision not ready'; end if;
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
 insert into public.marketing_events(user_id,revision_id,kind,payload) values(r.user_id,r.id,'approved',jsonb_build_object('publicationId',publication,'by','devshark-plan'));
 return publication;
end $$;
revoke all on function public.marketing_devshark_plan_approve(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_devshark_plan_approve(uuid,uuid,text) to service_role;
