-- Prepared only: accept richer briefs while preserving every v1 snapshot and function grant.
create or replace function public.marketing_dneskai_prepare_brief(p_owner uuid,p_brief uuid,p_value jsonb,p_scheduled_at timestamptz,p_status text,p_code text) returns jsonb language plpgsql set search_path='' as $$
declare b public.marketing_dneskai_briefs;v jsonb;
begin
 select * into b from public.marketing_dneskai_briefs where id=p_brief and user_id=p_owner for update;
 if not found then raise exception 'brief unavailable';end if;
 if b.status not in('pending','ready') then raise exception 'brief closed';end if;
 if p_status not in('pending','ready') or (p_code is not null and p_code !~ '^[a-z0-9-]{1,64}$') then raise exception 'brief state invalid';end if;
 v:=coalesce(p_value,b.brief);
 if v is null then
  if p_status<>'pending' then raise exception 'brief invalid';end if;
  update public.marketing_dneskai_briefs set status='pending',code=p_code,updated_at=clock_timestamp() where id=b.id returning * into b;
  return to_jsonb(b);
 end if;
 if jsonb_typeof(v) is distinct from 'object' or coalesce(v->>'schemaVersion','') not in ('dneskai-brief/1','dneskai-brief/2') or v->>'eventId' is distinct from b.event_id
  or v->>'memberHash' is distinct from b.member_hash or v->>'targetDate' is distinct from b.target_date::text or v->>'category' is distinct from b.category
  or jsonb_typeof(v->'evidence') is distinct from 'array' or jsonb_array_length(v->'evidence') not between 1 and 30
  or exists(select 1 from jsonb_array_elements(v->'evidence') x where not (x->>'candidateId'=any(b.member_ids)))
  or (v->>'scheduledAt')::timestamptz is distinct from coalesce(p_scheduled_at,b.scheduled_at) then raise exception 'brief invalid';end if;
 if (coalesce(p_scheduled_at,b.scheduled_at) at time zone 'Europe/Prague')::date<>b.target_date then raise exception 'brief slot invalid';end if;
 if marketing_private.dneskai_member_hash(p_owner,b.project_id,b.member_ids)<>b.member_hash then raise exception 'brief members changed';end if;
 update public.marketing_dneskai_briefs set brief=v,scheduled_at=coalesce(p_scheduled_at,b.scheduled_at),status=p_status,code=p_code,updated_at=clock_timestamp() where id=b.id returning * into b;
 return to_jsonb(b);
end $$;
