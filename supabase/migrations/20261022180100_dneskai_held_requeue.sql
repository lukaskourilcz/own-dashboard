-- Owner decision 13 (22 October 2026, audit C3): a report Jev held gets one automatic second chance. The automatic,
-- bounded form of the owner's release (marketing_dneskai_release_candidate in 20261022141512), with the same rules:
-- a held report with text, published within the last 30 days and not in the future, becomes open and unclassified
-- (status new; category, relevance, duplicateOf, reason and targetDate cleared; authored fields unchanged). The
-- collection's pending filter then offers it to that night's Jev batches under the existing stage, item and $0.25
-- daily limits; Jev may hold, reject or fold it again. Releasing is not approval.
--
-- Bounds: only Jev's own review holds (reason collection-review-*), held less than 48 hours ago, never a report that
-- was re-queued before (requeued_at records it and is never cleared), at most 16 reports a night (two Jev batches,
-- 2 x $0.003), and only once per run: under the run's fence, while it is running, today in Prague and before its
-- Jev stages are planned. Nothing here calls a provider or reserves money.
-- NOT APPLIED. The collector calls the function only when DNESKAI_SELECTION_V2_ENABLED=true.

alter table public.marketing_dneskai_candidates add column requeued_at timestamptz;

create function public.marketing_dneskai_requeue_held(p_owner uuid,p_run uuid,p_fence uuid) returns integer language plpgsql set search_path='' as $$
declare r public.marketing_dneskai_runs;moved integer;
begin
 select * into r from public.marketing_dneskai_runs where id=p_run and user_id=p_owner and fence=p_fence and lease_until>clock_timestamp() and status='running' for update;
 if not found then raise exception 'collection fence unavailable';end if;
 -- Once per run: a planned run has already chosen its Jev batches, and a run of a past day spends nothing.
 if r.collection_pilot_owner is not null or r.jev_stage_count is not null or r.date is distinct from (clock_timestamp() at time zone 'Europe/Prague')::date
  or exists(select 1 from public.marketing_dneskai_stages where run_id=p_run and kind='jev')
  -- A retried tick of the same run finds this run's re-queue (one run per day, admitted after 22:00) and adds none.
  or exists(select 1 from public.marketing_dneskai_candidates c where c.user_id=p_owner and c.project_id=r.project_id and c.requeued_at>=r.created_at) then return 0;end if;
 with picked as (
  select c.id from public.marketing_dneskai_candidates c
  where c.user_id=p_owner and c.project_id=r.project_id and c.status='held' and c.requeued_at is null
   and coalesce(c.candidate->>'reason','') like 'collection-review-%' and c.updated_at>=clock_timestamp()-interval '48 hours'
   and btrim(coalesce(c.candidate->>'title','')||coalesce(c.candidate->>'text',''))<>''
   and coalesce(c.candidate->>'publishedAt','')<>'' and (c.candidate->>'publishedAt')::timestamptz<=clock_timestamp()
   and (c.candidate->>'publishedAt')::timestamptz>=clock_timestamp()-interval '30 days'
  order by (c.candidate->>'relevance')::numeric desc nulls last,(c.candidate->>'publishedAt')::timestamptz desc,c.id collate "C"
  limit 16 for update
 )
 update public.marketing_dneskai_candidates c set status='new',target_date=null,updated_at=clock_timestamp(),requeued_at=clock_timestamp(),
  candidate=c.candidate||jsonb_build_object('status','new','category',null,'relevance',null,'duplicateOf',null,'reason',null,'targetDate',null)
 from picked where c.user_id=p_owner and c.project_id=r.project_id and c.id=picked.id;
 get diagnostics moved=row_count;
 return moved;
end $$;
revoke all on function public.marketing_dneskai_requeue_held(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_requeue_held(uuid,uuid,uuid) to service_role;
