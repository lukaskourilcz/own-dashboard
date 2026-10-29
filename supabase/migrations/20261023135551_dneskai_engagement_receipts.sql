-- Complete counts, independent of PostgREST's raw-row cap and the current review page.
-- Read-only, invoker/RLS-scoped, no commenter data and no service-role entry point.
create function public.marketing_dneskai_engagement_receipts(
 p_publication_ids uuid[], p_since timestamptz, p_until timestamptz
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 v_owner uuid := auth.uid();
 v_result jsonb;
begin
 if coalesce(cardinality(p_publication_ids),0)>60 or p_since is null or p_until is null
    or p_until<p_since or p_until-p_since>interval '7 days' then
   raise exception 'invalid receipt window' using errcode='22023';
 end if;
 with publication_times as (
   select x.revision_id,max(x.created_at) as published_at from public.marketing_events x
   where x.user_id=v_owner and x.kind='published' group by x.revision_id
 ), eligible as materialized (
   select p.id, coalesce(e.published_at,p.scheduled_at) between p_since and p_until as recent,
          greatest(coalesce(c.comments_seen,0),coalesce(c.pass_seen,0)) as comments_seen, c.last_checked_at
   from public.marketing_publications p
   join public.marketing_revisions v on v.id=p.revision_id and v.user_id=v_owner and v.brand='dneskai'
   left join publication_times e on e.revision_id=p.revision_id
   left join public.marketing_instagram_comment_checks c on c.publication_id=p.id and c.user_id=v_owner
   where p.user_id=v_owner and p.status='published' and p.platform='instagram'
     and jsonb_typeof(v.revision->'engagement')='object' and v.revision->'engagement'->>'keyword' ~ '^[A-Z0-9]{1,24}$'
     and (p.id=any(coalesce(p_publication_ids,'{}'::uuid[])) or coalesce(e.published_at,p.scheduled_at) between p_since and p_until)
 ), matches as materialized (
   select r.publication_id,r.status,r.public_status,
          case when r.error_code ~ '^[a-z][a-z0-9_-]{0,99}$' then r.error_code else 'reply-uncertain' end as error_code,
          r.status in ('failed','uncertain') or r.public_status in ('failed','uncertain') as failed
   from public.marketing_instagram_comment_replies r join eligible e on e.id=r.publication_id
   where r.user_id=v_owner
 ), totals as (
   select m.publication_id,count(*) as matches,
          count(*) filter(where m.status='sent') as private_sent,
          count(*) filter(where m.public_status='sent') as public_sent,
          count(*) filter(where m.failed) as failed
   from matches m group by m.publication_id
 ), buckets as (
   select m.publication_id,m.error_code,count(*) as count,
          row_number() over(partition by m.publication_id order by count(*) desc,m.error_code) as position
   from matches m where m.failed group by m.publication_id,m.error_code
 ), failures as (
   select b.publication_id,jsonb_agg(jsonb_build_object('code',b.error_code,'count',b.count) order by b.count desc,b.error_code) as codes
   from buckets b where b.position<=10 group by b.publication_id
 ), receipts as materialized (
   select e.*,coalesce(t.matches,0) as matches,coalesce(t.private_sent,0) as private_sent,
          coalesce(t.public_sent,0) as public_sent,coalesce(t.failed,0) as failed,coalesce(f.codes,'[]'::jsonb) as failures
   from eligible e left join totals t on t.publication_id=e.id left join failures f on f.publication_id=e.id
 )
 select jsonb_build_object(
   'receipts',coalesce((select jsonb_agg(jsonb_build_object(
     'publicationId',r.id,'commentsSeen',r.comments_seen,'keywordMatches',r.matches,'privateSent',r.private_sent,
     'publicSent',r.public_sent,'failedCount',r.failed,'failures',r.failures,'lastCheckedAt',r.last_checked_at) order by r.id)
     from receipts r where r.id=any(coalesce(p_publication_ids,'{}'::uuid[]))),'[]'::jsonb),
   'summary',(select jsonb_build_object('posts',count(*),'commentsSeen',coalesce(sum(r.comments_seen),0),
     'keywordMatches',coalesce(sum(r.matches),0),'privateSent',coalesce(sum(r.private_sent),0),
     'publicSent',coalesce(sum(r.public_sent),0),'failed',coalesce(sum(r.failed),0)) from receipts r where r.recent)
 ) into v_result;
 return v_result;
end $$;
revoke all on function public.marketing_dneskai_engagement_receipts(uuid[],timestamptz,timestamptz) from public,anon,service_role;
grant execute on function public.marketing_dneskai_engagement_receipts(uuid[],timestamptz,timestamptz) to authenticated;
comment on function public.marketing_dneskai_engagement_receipts(uuid[],timestamptz,timestamptz) is
 'Own-only complete per-publication reply receipts and rolling seven-day post totals. Counts all rows; returns one JSON object and up to 60 selected receipts.';
