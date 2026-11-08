-- Per-channel sharing switches (owner request, 8 November 2026). In the publishing calendar the owner turns a post's
-- version off (story, Instagram post, Threads, LinkedIn, Facebook) or the whole post. A row here means "off"; deleting
-- it turns the version back on. A switch belongs to a plan slot (DNESKAi `marketing_dneskai_plan`, devShark
-- `marketing_devshark_plan`), not to a revision, so it survives an edit in the Design Lab or the Studio.
--
-- The publishers respect it at the claim: `marketing_claim_due` never claims a publication whose revision a switched-off
-- slot channel names. The publication stays queued; switched back on in time, it goes out at its slot, otherwise the
-- claim records the missed window as it always has.

create table public.marketing_publishing_switches (
 user_id uuid not null references auth.users(id) on delete cascade,
 brand text not null check (brand in ('dneskai','devshark')),
 slot_id uuid not null,
 channel text not null check (channel in ('all','story','instagram','threads','linkedin','facebook')),
 created_at timestamptz not null default now(),
 primary key (user_id, brand, slot_id, channel)
);
create index marketing_publishing_switches_slot on public.marketing_publishing_switches(slot_id);

-- The slot must be the owner's, in the brand's own plan table.
create function marketing_private.publishing_switch_slot() returns trigger language plpgsql set search_path='' as $$
begin
 if new.brand='dneskai' and not exists(select 1 from public.marketing_dneskai_plan where id=new.slot_id and user_id=new.user_id) then raise exception 'foreign plan slot'; end if;
 if new.brand='devshark' and not exists(select 1 from public.marketing_devshark_plan where id=new.slot_id and user_id=new.user_id) then raise exception 'foreign plan slot'; end if;
 return new;
end $$;
revoke all on function marketing_private.publishing_switch_slot() from public,anon,authenticated;
create trigger publishing_switch_slot before insert or update on public.marketing_publishing_switches for each row execute function marketing_private.publishing_switch_slot();

alter table public.marketing_publishing_switches enable row level security;
revoke all on public.marketing_publishing_switches from public,anon,authenticated;
grant select,insert,delete on public.marketing_publishing_switches to authenticated;
grant all on public.marketing_publishing_switches to service_role;
create policy "publishing switches select own" on public.marketing_publishing_switches for select to authenticated using ((select auth.uid())=user_id);
create policy "publishing switches insert own" on public.marketing_publishing_switches for insert to authenticated with check ((select auth.uid())=user_id);
create policy "publishing switches delete own" on public.marketing_publishing_switches for delete to authenticated using ((select auth.uid())=user_id);

-- Is this revision a switched-off version of a plan slot? The Instagram post is the slot's head (DNESKAi) or its
-- Instagram revision (devShark); a DNESKAi Threads-only slot goes out as its head.
create function public.marketing_publication_switched_off(p_owner uuid,p_revision uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.marketing_publishing_switches s join public.marketing_dneskai_plan p on p.id=s.slot_id and p.user_id=s.user_id
  where s.user_id=p_owner and s.brand='dneskai' and (
   (s.channel in ('all','instagram') and p.instagram and coalesce(p.head_revision_id,p.revision_id)=p_revision)
   or (s.channel in ('all','threads') and (p.threads_revision_id=p_revision or (not p.instagram and coalesce(p.head_revision_id,p.revision_id)=p_revision)))
   or (s.channel in ('all','story') and p.story_revision_id=p_revision))
 ) or exists(
  select 1 from public.marketing_publishing_switches s join public.marketing_devshark_plan p on p.id=s.slot_id and p.user_id=s.user_id
  where s.user_id=p_owner and s.brand='devshark' and (
   (s.channel in ('all','instagram') and p.instagram_revision_id=p_revision)
   or (s.channel in ('all','threads') and p.threads_revision_id=p_revision)
   or (s.channel in ('all','story') and p.story_revision_id=p_revision))
 )
$$;
revoke all on function public.marketing_publication_switched_off(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_publication_switched_off(uuid,uuid) to service_role;

-- The claim of 20261013193104, unchanged except that a switched-off version is never claimed.
create or replace function public.marketing_claim_due(p_owner uuid,p_limit integer default 10,p_brand text default null,p_publication uuid default null)
returns setof public.marketing_publications language plpgsql set search_path='' as $$
begin
 -- An expired lease is ambiguous, not permission to send again.
 update public.marketing_publications set status='reconciliation',error_code='lease-expired' where user_id=p_owner and status='claimed' and lease_until<now();
 update public.marketing_revisions r set status='reconciliation' where r.user_id=p_owner and r.status='publishing' and exists(select 1 from public.marketing_publications p where p.revision_id=r.id and p.status='reconciliation');
 update public.marketing_revisions r set status='failed',approved_at=null,approved_hash=null where r.user_id=p_owner and r.status='approved' and exists(select 1 from public.marketing_publications p where p.revision_id=r.id and p.status='queued' and p.scheduled_at<now()-interval '15 minutes');
 update public.marketing_publications set status='failed',error_code='publish-window-expired' where user_id=p_owner and status='queued' and scheduled_at<now()-interval '15 minutes';
 return query with candidates as (
   select p.id from public.marketing_publications p join public.marketing_revisions r on r.id=p.revision_id
   where p.user_id=p_owner and (p_publication is null or p.id=p_publication) and (p_brand is null or r.brand=p_brand) and p.status='queued' and p.scheduled_at<=now() and p.scheduled_at>=now()-interval '15 minutes'
   and r.status='approved' and r.approved_hash=r.content_hash and r.ready
   and public.marketing_revision_campaign_active(p_owner,r.campaign_id,r.calendar_entry_id)
   and p.scheduled_at=(r.revision->>'scheduledAt')::timestamptz
   and public.marketing_sources_valid(p_owner,r.brand,r.revision,now(),true)
   and not public.marketing_publication_switched_off(p_owner,r.id)
   and exists(select 1 from public.marketing_accounts a where a.user_id=p_owner and a.brand=r.brand and a.platform=p.platform
     and a.remote_account_id=r.revision->'account'->>'id' and a.enabled and a.verified_at is not null)
   order by p.scheduled_at for update of p skip locked limit least(greatest(p_limit,1),20)
 ), claimed as (
   update public.marketing_publications p set status='claimed',lease_until=now()+interval '10 minutes',attempts=attempts+1
   where p.id in (select id from candidates) returning p.*
 ) select * from claimed;
end $$;
revoke all on function public.marketing_claim_due(uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.marketing_claim_due(uuid,integer,text,uuid) to service_role;
