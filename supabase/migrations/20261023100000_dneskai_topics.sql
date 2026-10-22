-- Prepared only; not applied. DNESKAi topics ("náměty", #150, plan A1): a title-only candidate the owner approves
-- before anything is paid for. Nothing proposes topics yet (scouting and titling come later) and nothing consumes
-- them yet (the topic-to-brief bridge comes later). The application reads this table and calls the owner functions
-- below only when the server-only DNESKAI_TOPICS_ENABLED is "true", which the owner sets after this file is applied.
--
-- Reads are own-only through RLS. The pipeline writes with service_role. The owner changes a topic only through the
-- three security-definer functions below (the pattern of marketing_dneskai_release_candidate), executable by
-- authenticated only and scoped by auth.uid(). None of them admits a job, writes a brief or spends money.

create table public.marketing_dneskai_topics (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 kind text not null check(kind in('news','education')),
 source_kind text not null check(source_kind in('feed','instagram','library','manual')),
 -- What the topic came from (a feed item, a reel, a link, a manual URL or title); one topic per source and owner.
 source_ref text not null check(char_length(source_ref) between 1 and 300),
 title_cs text not null check(char_length(btrim(title_cs)) between 1 and 160 and title_cs=btrim(title_cs)),
 summary text check(summary is null or char_length(summary)<=600),
 -- The comment keyword the post may ask for: one word in Latin letters.
 keyword text check(keyword is null or keyword ~ '^[A-Za-z]{2,24}$'),
 verdict text check(verdict is null or verdict in('fact','hype','unclear')),
 -- urls, excerpts, transcript hash and picture candidates; validated in TypeScript.
 evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object'),
 status text not null default 'proposed' check(status in('proposed','approved','rejected','expired','enriching','briefed','generated')),
 proposed_for date not null default ((clock_timestamp() at time zone 'Europe/Prague')::date),
 approved_at timestamptz,
 brief_id uuid references public.marketing_dneskai_briefs(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(user_id,source_ref),
 check(status not in('approved','enriching','briefed','generated') or approved_at is not null)
);
create index marketing_dneskai_topics_owner_status on public.marketing_dneskai_topics(user_id,project_id,status,proposed_for desc);
alter table public.marketing_dneskai_topics enable row level security;
revoke all on public.marketing_dneskai_topics from public,anon,authenticated;
grant select on public.marketing_dneskai_topics to authenticated;
grant all on public.marketing_dneskai_topics to service_role;
create policy owner_read on public.marketing_dneskai_topics for select to authenticated using ((select auth.uid())=user_id);
-- project_id ownership, the same check the other collection tables use.
create trigger collection_ownership before insert or update on public.marketing_dneskai_topics for each row execute function public.marketing_dneskai_ownership();

-- approve: proposed -> approved. reject: proposed or approved (nothing started yet) -> rejected.
-- restore: rejected or expired -> proposed, approval cleared. Anything else raises 'topic status'.
create function public.marketing_dneskai_topic_decide(p_topic uuid,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid());t public.marketing_dneskai_topics;
begin
 if v_owner is null then raise exception 'topic unavailable';end if;
 if p_action is null or p_action not in('approve','reject','restore') then raise exception 'topic action invalid';end if;
 select * into t from public.marketing_dneskai_topics where user_id=v_owner and id=p_topic for update;
 if not found then raise exception 'topic unavailable';end if;
 if p_action='approve' then
  if t.status<>'proposed' then raise exception 'topic status';end if;
  update public.marketing_dneskai_topics set status='approved',approved_at=clock_timestamp(),updated_at=clock_timestamp() where id=t.id returning * into t;
 elsif p_action='reject' then
  if t.status not in('proposed','approved') then raise exception 'topic status';end if;
  update public.marketing_dneskai_topics set status='rejected',approved_at=null,updated_at=clock_timestamp() where id=t.id returning * into t;
 else
  if t.status not in('rejected','expired') then raise exception 'topic status';end if;
  update public.marketing_dneskai_topics set status='proposed',approved_at=null,updated_at=clock_timestamp() where id=t.id returning * into t;
 end if;
 return jsonb_build_object('id',t.id,'status',t.status);
end $$;
revoke all on function public.marketing_dneskai_topic_decide(uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_topic_decide(uuid,text) to authenticated;

-- The owner edits the working title and the keyword (null clears it) until enrichment starts.
create function public.marketing_dneskai_topic_edit(p_topic uuid,p_title text,p_keyword text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid());t public.marketing_dneskai_topics;
begin
 if v_owner is null then raise exception 'topic unavailable';end if;
 select * into t from public.marketing_dneskai_topics where user_id=v_owner and id=p_topic for update;
 if not found then raise exception 'topic unavailable';end if;
 if t.status not in('proposed','approved','rejected','expired') then raise exception 'topic status';end if;
 update public.marketing_dneskai_topics set title_cs=btrim(p_title),keyword=nullif(btrim(coalesce(p_keyword,'')),''),updated_at=clock_timestamp() where id=t.id returning * into t;
 return jsonb_build_object('id',t.id,'status',t.status);
end $$;
revoke all on function public.marketing_dneskai_topic_edit(uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_topic_edit(uuid,text,text) to authenticated;

-- A manual topic from a URL, a title or both. It starts as proposed; the owner approves it like any other.
-- The source reference hashes the URL, or the lower-cased title when there is no URL, so the same link is one topic.
create function public.marketing_dneskai_topic_create(p_project uuid,p_kind text,p_title text,p_url text,p_keyword text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid());t public.marketing_dneskai_topics;v_ref text;
begin
 if v_owner is null or not exists(select 1 from public.projects where id=p_project and user_id=v_owner) then raise exception 'topic unavailable';end if;
 if p_url is not null and (p_url !~ '^https://[^\s]+$' or char_length(p_url)>2048) then raise exception 'topic url invalid';end if;
 if nullif(btrim(coalesce(p_title,'')),'') is null and p_url is null then raise exception 'topic title invalid';end if;
 v_ref:='manual:'||encode(sha256(convert_to(coalesce(p_url,lower(btrim(p_title))),'UTF8')),'hex');
 if exists(select 1 from public.marketing_dneskai_topics where user_id=v_owner and source_ref=v_ref) then raise exception 'topic exists';end if;
 insert into public.marketing_dneskai_topics(user_id,project_id,kind,source_kind,source_ref,title_cs,keyword,evidence)
  values(v_owner,p_project,p_kind,'manual',v_ref,btrim(coalesce(nullif(btrim(coalesce(p_title,'')),''),left(p_url,160))),nullif(btrim(coalesce(p_keyword,'')),''),
   case when p_url is null then '{}'::jsonb else jsonb_build_object('urls',jsonb_build_array(p_url)) end)
  returning * into t;
 return jsonb_build_object('id',t.id,'status',t.status);
end $$;
revoke all on function public.marketing_dneskai_topic_create(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_topic_create(uuid,text,text,text,text) to authenticated;
