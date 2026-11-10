-- Faceless brand strategy: idempotent handoff into existing drafts/topics and manual native-Insights snapshots.
-- No scheduler, budget, approval or publishing switches change.
alter table public.user_preferences drop constraint if exists user_preferences_hidden_project_tabs_check;
alter table public.user_preferences add constraint user_preferences_hidden_project_tabs_check check (
 hidden_project_tabs <@ array['overview','tasks','activity','communication','repository','finance','competition','knowledge','sources','scaling','monetization','dneskai-review','dneskai-calendar','dneskai-published','dneskai-costs','dneskai-today','dneskai-promo','devshark-studio','strategy']::text[]
);

create function marketing_private.strategy_project(p_project uuid,p_brand text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.projects p where p.id=p_project and p.user_id=(select auth.uid()) and p.parent_id is null and
  ((p_brand='devshark' and (p.portfolio_key='react-express-app' or (p.portfolio_key is null and p.repo_full_name='lukaskourilcz/react-express-app')))
   or (p_brand='dneskai' and (p.portfolio_key='aifirst' or (p.portfolio_key is null and p.repo_full_name='lukaskourilcz/aifirst')))));
$$;
revoke all on function marketing_private.strategy_project(uuid,text) from public,anon,authenticated;

create table public.marketing_strategy_links (
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 brand text not null check(brand in ('devshark','dneskai')),
 idea_id text not null check(idea_id ~ '^[a-z][a-z0-9-]{0,60}$'),
 draft_id uuid references public.marketing_devshark_drafts(id) on delete cascade,
 topic_id uuid references public.marketing_dneskai_topics(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 primary key(user_id,project_id,brand,idea_id),
 check((brand='devshark' and draft_id is not null and topic_id is null) or (brand='dneskai' and topic_id is not null and draft_id is null))
);
alter table public.marketing_strategy_links enable row level security;
revoke all on public.marketing_strategy_links from public,anon,authenticated;
grant select on public.marketing_strategy_links to authenticated;
grant all on public.marketing_strategy_links to service_role;
create policy owner_read on public.marketing_strategy_links for select to authenticated using((select auth.uid())=user_id);

create function public.marketing_strategy_draft(p_project uuid,p_brand text,p_idea text,p_title text,p_deck jsonb,p_caption text,p_url text,p_keyword text,p_brief text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid());v_draft uuid;v_topic uuid;v_link public.marketing_strategy_links;
begin
 if not marketing_private.strategy_project(p_project,p_brand) then raise exception 'strategy project unavailable'; end if;
 if p_idea is null or p_idea !~ '^[a-z][a-z0-9-]{0,60}$' or p_title is null or char_length(btrim(p_title)) not between 1 and 160
  or p_brief is null or char_length(p_brief)>10000 then raise exception 'strategy input invalid'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||p_project::text||p_brand||p_idea,0));
 select * into v_link from public.marketing_strategy_links where user_id=v_owner and project_id=p_project and brand=p_brand and idea_id=p_idea;
 if found then return jsonb_build_object('idea_id',p_idea,'draft_id',v_link.draft_id,'topic_id',v_link.topic_id); end if;
 if p_brand='devshark' then
  if p_caption is null or char_length(p_caption) not between 1 and 2200 or p_deck is null or p_deck->>'schemaVersion' is distinct from 'devshark-deck/1'
   or jsonb_typeof(p_deck->'slides') is distinct from 'array' then raise exception 'strategy input invalid'; end if;
  insert into public.marketing_devshark_drafts(user_id,project_id,title,deck,caption,origin,status)
   values(v_owner,p_project,btrim(p_title),p_deck,p_caption,'concept','draft') returning id into v_draft;
 else
  if p_url is null or p_url !~ '^https://[^\s]+$' or char_length(p_url)>2048 or
   (p_keyword is not null and p_keyword !~ '^[A-Za-z]{2,24}$') then raise exception 'strategy input invalid'; end if;
  insert into public.marketing_dneskai_topics(user_id,project_id,kind,source_kind,source_ref,title_cs,keyword,evidence,status)
   values(v_owner,p_project,'education','manual','strategy:'||p_project::text||':'||p_idea,btrim(p_title),p_keyword,
    jsonb_build_object('urls',jsonb_build_array(p_url),'strategyIdeaId',p_idea,'strategyBrief',p_brief),'proposed') returning id into v_topic;
 end if;
 insert into public.marketing_strategy_links(user_id,project_id,brand,idea_id,draft_id,topic_id)
  values(v_owner,p_project,p_brand,p_idea,v_draft,v_topic);
 return jsonb_build_object('idea_id',p_idea,'draft_id',v_draft,'topic_id',v_topic);
end $$;
revoke all on function public.marketing_strategy_draft(uuid,text,text,text,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.marketing_strategy_draft(uuid,text,text,text,jsonb,text,text,text,text) to authenticated;

create table public.marketing_strategy_results (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 brand text not null check(brand in ('devshark','dneskai')),
 publication_id uuid not null references public.marketing_publications(id) on delete cascade,
 published_at timestamptz not null,
 observed_at timestamptz not null check(observed_at>=published_at),
 experiment text not null check(experiment in ('baseline','hook','threads','story')),
 variant text not null check(variant in ('A','B')),
 evidence text not null check(char_length(btrim(evidence)) between 3 and 500),
 metrics jsonb not null check(jsonb_typeof(metrics)='object'),
 created_at timestamptz not null default clock_timestamp(),
 unique(user_id,publication_id,observed_at)
);
create index marketing_strategy_results_owner on public.marketing_strategy_results(user_id,project_id,observed_at desc);
create function marketing_private.strategy_result_check() returns trigger language plpgsql security definer set search_path='' as $$
declare v_pair record;v_key text;v_value jsonb;v_measured boolean:=false;
begin
 if new.user_id is distinct from (select auth.uid()) or not marketing_private.strategy_project(new.project_id,new.brand) then raise exception 'strategy project unavailable'; end if;
 select p.user_id,p.status,p.platform,p.remote_media_id,r.brand,r.revision into v_pair from public.marketing_publications p
  join public.marketing_revisions r on r.id=p.revision_id and r.user_id=p.user_id where p.id=new.publication_id;
 if not found or v_pair.user_id<>new.user_id or v_pair.brand<>new.brand or v_pair.status<>'published' or
  nullif(btrim(v_pair.remote_media_id),'') is null or v_pair.revision->>'brand' is distinct from new.brand or
  v_pair.revision->'account'->>'platform' is distinct from v_pair.platform or
  (v_pair.revision->>'format'='story' and v_pair.platform<>'instagram') then raise exception 'strategy publication unavailable'; end if;
 if new.observed_at>clock_timestamp()+interval '5 minutes' then raise exception 'strategy observation in future'; end if;
 if (new.experiment='hook' and (v_pair.platform<>'instagram' or v_pair.revision->>'format'='story')) or
  (new.experiment='threads' and v_pair.platform<>'threads') or
  (new.experiment='story' and v_pair.revision->>'format' is distinct from 'story') then raise exception 'strategy experiment channel mismatch'; end if;
 if (select count(*) from jsonb_object_keys(new.metrics))<>9 then raise exception 'strategy metrics invalid'; end if;
 for v_key,v_value in select * from jsonb_each(new.metrics) loop
  if v_key not in ('reach','views','saves','shares','replies','follows','profileVisits','linkVisits','productionMinutes') then raise exception 'strategy metrics invalid'; end if;
  if v_value<>'null'::jsonb then
   if jsonb_typeof(v_value)<>'number' or v_value::text !~ '^[0-9]+$' or (v_value::text)::numeric>2000000000 then raise exception 'strategy metrics invalid'; end if;
   v_measured:=true;
  end if;
 end loop;
 if not v_measured then raise exception 'strategy measurement required'; end if;
 return new;
end $$;
revoke all on function marketing_private.strategy_result_check() from public,anon,authenticated;
create trigger strategy_result_check before insert on public.marketing_strategy_results for each row execute function marketing_private.strategy_result_check();
alter table public.marketing_strategy_results enable row level security;
revoke all on public.marketing_strategy_results from public,anon,authenticated;
grant select,insert on public.marketing_strategy_results to authenticated;
grant all on public.marketing_strategy_results to service_role;
create policy owner_read on public.marketing_strategy_results for select to authenticated using((select auth.uid())=user_id);
create policy owner_insert on public.marketing_strategy_results for insert to authenticated with check((select auth.uid())=user_id);
