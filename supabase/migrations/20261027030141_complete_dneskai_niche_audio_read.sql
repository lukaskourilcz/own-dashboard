-- Complete bounded ranking facts from one statement snapshot, without captions,
-- source URLs, media URLs, classification or other future candidate fields.
set lock_timeout='5s';
create index dneskai_niche_audio_recent on public.marketing_dneskai_candidates(user_id,project_id,created_at desc,id collate "C")
 where candidate#>'{instagram,music}' is not null;

create function public.read_dneskai_niche_audio(p_owner uuid,p_project uuid,p_source_ids text[],p_since timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' set lock_timeout='5s' as $$
declare rows jsonb;
begin
 if current_user<>'service_role' then raise exception 'Niche audio unavailable' using errcode='42501';end if;
 if p_owner is null or p_project is null or not exists(select 1 from public.projects where id=p_project and user_id=p_owner) then
  raise exception 'Niche audio unavailable' using errcode='42501';end if;
 if p_since is null or p_until is null or not isfinite(p_since) or not isfinite(p_until)
  or p_until-p_since<>interval '7 days' or p_until>clock_timestamp()+interval '5 minutes'
  or p_source_ids is null or coalesce(array_ndims(p_source_ids),1)<>1 or cardinality(p_source_ids)>120
  or exists(select 1 from unnest(p_source_ids) source where source is null or length(source) not between 1 and 100 or source ~ '[[:cntrl:]]')
  or (select count(distinct source) from unnest(p_source_ids) source)<>cardinality(p_source_ids) then
  raise exception 'Niche audio invalid' using errcode='22023';end if;
 with selected as (
  select c.id,c.created_at,c.candidate from public.marketing_dneskai_candidates c
  where c.user_id=p_owner and c.project_id=p_project and c.created_at>=p_since and c.created_at<=p_until
   and c.candidate->>'sourceId'=any(p_source_ids) and c.candidate#>'{instagram,music}' is not null
  order by c.created_at desc,c.id collate "C" limit 10001
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'createdAt',created_at,'sourceId',candidate->'sourceId','externalId',candidate->'externalId',
  'instagram',jsonb_build_object('plays',coalesce(candidate#>'{instagram,plays}','0'::jsonb),
   'music',jsonb_build_object('audioId',candidate#>'{instagram,music,audioId}',
    'title',candidate#>'{instagram,music,title}','artist',candidate#>'{instagram,music,artist}',
    'originalAudio',candidate#>'{instagram,music,originalAudio}','muted',candidate#>'{instagram,music,muted}')))
  order by created_at desc,id collate "C"),'[]'::jsonb) into rows from selected;
 if jsonb_array_length(rows)>10000 or octet_length(rows::text)>10485760 then raise exception 'Niche audio snapshot too large' using errcode='54000';end if;
 return jsonb_build_object('ownerId',p_owner,'projectId',p_project,'sourceIds',to_jsonb(p_source_ids),'since',p_since,'until',p_until,'rows',rows);
end $$;
revoke all on function public.read_dneskai_niche_audio(uuid,uuid,text[],timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.read_dneskai_niche_audio(uuid,uuid,text[],timestamptz,timestamptz) to service_role;
