-- Owner "give up and re-queue" for a publication that provably published nothing
-- (audit finding approval-04). UNAPPLIED: the deployed code works without it and
-- only calls it when the server-only MARKETING_PUBLICATION_REQUEUE_ENABLED=true.
--
-- The publisher writes its only durable intent, `publish-intent`, after the
-- parent container ID is stored and before the single media_publish request,
-- under a still-valid claim. A publication whose stored container is not a
-- numeric Meta ID and which has no media ID or URL therefore never reached
-- media_publish. That covers rows stranded by the older container-create
-- intent (`intent:<hash>`) and claims that expired before a container existed.
-- Such a row may go back to `queued`; its revision keeps its approval, hash and
-- bytes. Any row with a numeric container, a media ID or a URL is refused and
-- stays with the read-only reconciliation.
create function public.marketing_requeue_publication(p_publication uuid)
returns text language plpgsql security definer set search_path='' as $$
declare p public.marketing_publications; r public.marketing_revisions;
begin
 select * into p from public.marketing_publications where id=p_publication and user_id=(select auth.uid()) for update;
 if not found then raise exception 'publication unavailable'; end if;
 -- Only reconciliation, or a claim whose lease ran out (the run that held it is
 -- gone and can no longer write a publish intent through the checkpoint fence).
 if not (p.status='reconciliation' or (p.status='claimed' and p.lease_until<now())) then raise exception 'publication not stranded'; end if;
 if p.remote_media_id is not null or p.remote_url is not null or coalesce(p.remote_container_id,'') ~ '^\d{1,100}$' or p.error_code='publish-intent'
 then raise exception 'publication may be published'; end if;
 select * into r from public.marketing_revisions where id=p.revision_id and user_id=p.user_id for update;
 if not found or r.status not in ('approved','publishing','reconciliation') or not r.ready or r.approved_at is null or r.approved_hash is distinct from r.content_hash
 then raise exception 'approval changed'; end if;
 update public.marketing_publications set status='queued',remote_container_id=null,error_code='owner-requeued',lease_until=null,last_checked_at=null where id=p.id;
 -- approved_at and approved_hash stay exactly as they were.
 update public.marketing_revisions set status='approved' where id=r.id;
 insert into public.marketing_events(user_id,revision_id,kind,payload)
 values(p.user_id,r.id,'requeued',jsonb_build_object('publicationId',p.id,'previousStatus',p.status,'previousError',p.error_code));
 -- A slot more than 15 minutes old is expired by the next marketing_claim_due like any missed slot.
 return case when p.scheduled_at<now()-interval '15 minutes' then 'queued-window-passed' else 'queued' end;
end $$;
revoke all on function public.marketing_requeue_publication(uuid) from public,anon,authenticated;
grant execute on function public.marketing_requeue_publication(uuid) to authenticated;
