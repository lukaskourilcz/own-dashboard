-- Prepared only; not applied. DNESKAi sources as owner-editable rows (#174, plan D6): what the nightly collection and
-- the scouting step read. Until the server-only DNESKAI_SOURCES_TABLE_ENABLED is "true" the code ignores this table and
-- reads the registry file (src/lib/marketing/dneskai-registry.ts), which is also the seed of the first rows.
--
-- Reads are own-only through RLS. The owner writes only through the three security-definer functions below, executable
-- by authenticated only and scoped by auth.uid(); the pipeline reads with service_role. When a source was last read,
-- how many items it brought and its last error stay in marketing_dneskai_source_states, keyed by the same source_id.

create table public.marketing_dneskai_sources (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 -- The id the collection stages, source states and candidates carry: a registry id, instagram:<handle> or web-<slug>.
 source_id text not null check(source_id ~ '^[a-z0-9][a-z0-9:._-]{0,79}$'),
 kind text not null check(kind in('instagram','rss','html','hn','hnsearch','arxiv','bluesky','spaceflight','github','stackexchange')),
 topic text not null check(topic in('news','education')),
 -- An Instagram handle without the @, or the https URL of a feed or page.
 handle_or_url text not null check(char_length(handle_or_url) between 1 and 2048),
 name text not null check(char_length(btrim(name)) between 1 and 120 and name=btrim(name)),
 -- 0 the original publisher, 1 a newsroom, 2 an aggregator or repost account (dneskaiSourceTier).
 tier smallint not null default 1 check(tier between 0 and 2),
 -- Prague weekdays, 0 = Sunday.
 weekdays smallint[] not null check(cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
 max_items smallint not null check(max_items between 1 and 20),
 enabled boolean not null default true,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(user_id,project_id,source_id),
 check(kind<>'instagram' or (handle_or_url ~ '^[a-z0-9._]{1,30}$' and source_id='instagram:'||handle_or_url)),
 check(kind='instagram' or handle_or_url ~ '^https://[^\s]+$')
);
create index marketing_dneskai_sources_owner on public.marketing_dneskai_sources(user_id,project_id,enabled);
alter table public.marketing_dneskai_sources enable row level security;
revoke all on public.marketing_dneskai_sources from public,anon,authenticated;
grant select on public.marketing_dneskai_sources to authenticated;
grant all on public.marketing_dneskai_sources to service_role;
create policy owner_read on public.marketing_dneskai_sources for select to authenticated using ((select auth.uid())=user_id);
-- project_id ownership, the same check the other collection tables use.
create trigger collection_ownership before insert or update on public.marketing_dneskai_sources for each row execute function public.marketing_dneskai_ownership();

-- The first rows: the registry file, sent by the server once. Inserts nothing when the owner already has a row for the
-- project, so a source the owner removed never comes back. Returns the number of rows inserted.
create function public.marketing_dneskai_sources_seed(p_project uuid,p_rows jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid());v_count integer;
begin
 if v_owner is null or not exists(select 1 from public.projects where id=p_project and user_id=v_owner) then raise exception 'source unavailable';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 120 then raise exception 'source invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||p_project::text||'dneskai-sources-seed',0));
 if exists(select 1 from public.marketing_dneskai_sources where user_id=v_owner and project_id=p_project) then return 0;end if;
 insert into public.marketing_dneskai_sources(user_id,project_id,source_id,kind,topic,handle_or_url,name,tier,weekdays,max_items,enabled)
  select v_owner,p_project,r->>'sourceId',r->>'kind',r->>'topic',r->>'handleOrUrl',r->>'name',(r->>'tier')::smallint,
   array(select jsonb_array_elements_text(r->'weekdays')::smallint),(r->>'maxItems')::smallint,coalesce((r->>'enabled')::boolean,true)
  from jsonb_array_elements(p_rows) r;
 get diagnostics v_count=row_count;
 return v_count;
end $$;
revoke all on function public.marketing_dneskai_sources_seed(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_sources_seed(uuid,jsonb) to authenticated;

-- Adds a source or changes one, matched by source_id. The kind, handle or URL of an existing row never change: a new
-- address is a new source. At most 120 sources per project.
create function public.marketing_dneskai_source_save(p_project uuid,p_source jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid());s public.marketing_dneskai_sources;
begin
 if v_owner is null or not exists(select 1 from public.projects where id=p_project and user_id=v_owner) then raise exception 'source unavailable';end if;
 if jsonb_typeof(p_source) is distinct from 'object' or jsonb_typeof(p_source->'weekdays') is distinct from 'array' then raise exception 'source invalid';end if;
 select * into s from public.marketing_dneskai_sources where user_id=v_owner and project_id=p_project and source_id=p_source->>'sourceId' for update;
 if found then
  if s.kind is distinct from p_source->>'kind' or s.handle_or_url is distinct from p_source->>'handleOrUrl' then raise exception 'source address changed';end if;
  update public.marketing_dneskai_sources set topic=p_source->>'topic',name=p_source->>'name',tier=(p_source->>'tier')::smallint,
   weekdays=array(select jsonb_array_elements_text(p_source->'weekdays')::smallint),max_items=(p_source->>'maxItems')::smallint,
   enabled=(p_source->>'enabled')::boolean,updated_at=clock_timestamp() where id=s.id returning * into s;
 else
  if (select count(*) from public.marketing_dneskai_sources where user_id=v_owner and project_id=p_project)>=120 then raise exception 'source limit';end if;
  insert into public.marketing_dneskai_sources(user_id,project_id,source_id,kind,topic,handle_or_url,name,tier,weekdays,max_items,enabled)
   values(v_owner,p_project,p_source->>'sourceId',p_source->>'kind',p_source->>'topic',p_source->>'handleOrUrl',p_source->>'name',(p_source->>'tier')::smallint,
    array(select jsonb_array_elements_text(p_source->'weekdays')::smallint),(p_source->>'maxItems')::smallint,coalesce((p_source->>'enabled')::boolean,true))
   returning * into s;
 end if;
 return jsonb_build_object('id',s.id,'sourceId',s.source_id,'enabled',s.enabled);
end $$;
revoke all on function public.marketing_dneskai_source_save(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_source_save(uuid,jsonb) to authenticated;

-- Removes a source. Its past stages, states and candidates stay; the next night simply does not read it.
create function public.marketing_dneskai_source_remove(p_project uuid,p_source_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid());v_id uuid;
begin
 if v_owner is null then raise exception 'source unavailable';end if;
 delete from public.marketing_dneskai_sources where user_id=v_owner and project_id=p_project and source_id=p_source_id returning id into v_id;
 if v_id is null then raise exception 'source unavailable';end if;
 return jsonb_build_object('sourceId',p_source_id,'removed',true);
end $$;
revoke all on function public.marketing_dneskai_source_remove(uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_dneskai_source_remove(uuid,text) to authenticated;
