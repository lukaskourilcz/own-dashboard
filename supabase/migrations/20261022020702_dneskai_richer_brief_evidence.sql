-- Prepared only; reconcile production migration history before any approved release.
-- Preserve public article prose even when a page offers no usable images. No paid calls or switches.
alter table public.marketing_media_collections add column article_text text not null default '' check(length(article_text)<=4000);

create function public.marketing_media_set_evidence(p_owner uuid,p_project uuid,p_candidate text,p_fence uuid,p_article_text text)
returns void language plpgsql set search_path='' as $$
declare c public.marketing_media_collections;
begin
 if p_article_text is null or length(p_article_text)>4000 then raise exception 'media evidence invalid'; end if;
 select * into c from public.marketing_media_collections where user_id=p_owner and project_id=p_project and candidate_id=p_candidate
  and fence=p_fence and lease_until>clock_timestamp() and status='pending' for update;
 if not found then raise exception 'media fence unavailable'; end if;
 if c.plan is not null then raise exception 'media evidence already fixed'; end if;
 update public.marketing_media_collections set article_text=p_article_text where user_id=p_owner and project_id=p_project and candidate_id=p_candidate;
end $$;
revoke all on function public.marketing_media_set_evidence(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_media_set_evidence(uuid,uuid,text,uuid,text) to service_role;
