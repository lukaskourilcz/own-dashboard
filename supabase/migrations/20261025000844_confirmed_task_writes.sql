-- Captured task writes retain existing task/repository metadata and own-only RLS.
-- now() is a stable fast default: existing rows gain a version without a volatile-default heap rewrite.
set lock_timeout='5s';
alter table public.todos add column updated_at timestamptz not null default now();
alter table public.todos add constraint todos_updated_at_finite check(isfinite(updated_at));
create function public.bump_todo_version() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 return new;
end $$;
revoke all on function public.bump_todo_version() from public,anon,authenticated,service_role;
create trigger bump_todo_version before update on public.todos for each row execute function public.bump_todo_version();

-- Metadata only, not another copy of task text. Retain after task removal so an ambiguous create retry cannot
-- recreate a deliberately deleted task. Account removal cascades this private metadata with the owner's data.
create schema dashboard_private;
revoke all on schema dashboard_private from public,anon,authenticated,service_role;
grant usage on schema dashboard_private to authenticated;
create table dashboard_private.task_create_receipts(
 user_id uuid not null references auth.users(id) on delete cascade,
 task_id uuid not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null check(isfinite(created_at)),
 primary key(user_id,task_id)
);
alter table dashboard_private.task_create_receipts enable row level security;
revoke all on dashboard_private.task_create_receipts from public,anon,authenticated,service_role;
grant select,insert on dashboard_private.task_create_receipts to authenticated;
create policy task_receipt_select on dashboard_private.task_create_receipts for select to authenticated using((select auth.uid())=user_id);
create policy task_receipt_insert on dashboard_private.task_create_receipts for insert to authenticated with check((select auth.uid())=user_id);

create function public.write_task(p_owner uuid,p_id uuid,p_action text,p_expected jsonb,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=(select auth.uid());
 source public.todos; saved public.todos;
 receipt dashboard_private.task_create_receipts;
 source_json jsonb; saved_json jsonb; persisted jsonb; expected_values jsonb; result jsonb;
 outcome text; existed boolean; receipted boolean; field text; request_hash text; stamp timestamptz;
 wanted_due date; wanted_project uuid; wanted_organization uuid; wanted_importance smallint; wanted_minutes integer;
 fields text[]:=array['title','due_date','importance','estimated_minutes','task_kind','is_global','project_id','organization_id'];
 empty_fields text[]:=array['category','source','repo_id','repo_full_name','repo_owner','repo_name','repo_url','needed_raw','needed_assignee','generated_at','opportunity_id','job_application_id'];
begin
 if actor is null or actor is distinct from p_owner then raise exception 'Task unavailable' using errcode='42501'; end if;
 if p_id is null or p_action is null or p_action not in('create','toggle','delete') or p_values is null
  or jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>8192 then
  raise exception 'Task invalid' using errcode='22023';
 end if;
 if p_action='create' then
  if p_expected is not null or not(p_values ?& fields) or (p_values-fields)<>'{}'::jsonb
   or jsonb_typeof(p_values->'title')<>'string' or length(p_values->>'title') not between 1 and 500 or length(btrim(p_values->>'title'))=0
   or jsonb_typeof(p_values->'is_global')<>'boolean'
   or exists(select 1 from unnest(array['due_date','task_kind','project_id','organization_id']) k where jsonb_typeof(p_values->k) not in('string','null'))
   or exists(select 1 from unnest(array['importance','estimated_minutes']) k where jsonb_typeof(p_values->k) not in('number','null')) then
   raise exception 'Task invalid' using errcode='22023';
  end if;
  if p_values->>'importance' is not null then
   if (p_values->>'importance')::numeric<>trunc((p_values->>'importance')::numeric) then raise exception 'Task invalid' using errcode='22023'; end if;
   wanted_importance:=(p_values->>'importance')::smallint;
   if wanted_importance not between 1 and 6 then raise exception 'Task invalid' using errcode='22023'; end if;
  end if;
  if p_values->>'estimated_minutes' is not null then
   if (p_values->>'estimated_minutes')::numeric<>trunc((p_values->>'estimated_minutes')::numeric) then raise exception 'Task invalid' using errcode='22023'; end if;
   wanted_minutes:=(p_values->>'estimated_minutes')::integer;
   if wanted_minutes not between 1 and 100000 then raise exception 'Task invalid' using errcode='22023'; end if;
  end if;
  if p_values->>'task_kind' is not null and p_values->>'task_kind' not in('setup','deploy','legal','content','decision') then raise exception 'Task invalid' using errcode='22023'; end if;
  if p_values->>'due_date' is not null then
   if p_values->>'due_date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Task invalid' using errcode='22023'; end if;
   wanted_due:=(p_values->>'due_date')::date;
   if not isfinite(wanted_due) or extract(year from wanted_due) not between 1 and 9999 then raise exception 'Task invalid' using errcode='22023'; end if;
  end if;
  wanted_project:=(p_values->>'project_id')::uuid; wanted_organization:=(p_values->>'organization_id')::uuid;
  if (p_values->>'is_global')::boolean then
   if wanted_importance is distinct from 6 or wanted_project is not null then raise exception 'Task invalid' using errcode='22023'; end if;
  elsif wanted_importance=6 then raise exception 'Task invalid' using errcode='22023'; end if;
  if (wanted_project is not null and not exists(select 1 from public.projects p where p.id=wanted_project and p.user_id=actor))
   or (wanted_organization is not null and not exists(select 1 from public.organizations o where o.id=wanted_organization and o.user_id=actor)) then
   raise exception 'Task unavailable' using errcode='42501';
  end if;
  -- Match repository import's collection lock, including the absent-id/count case.
  perform pg_advisory_xact_lock(hashtextextended('repository-tasks:'||actor::text,0));
  expected_values:=jsonb_build_object('title',p_values->>'title','due_date',wanted_due,'importance',wanted_importance,
   'estimated_minutes',wanted_minutes,'task_kind',p_values->>'task_kind','is_global',(p_values->>'is_global')::boolean,
   'project_id',wanted_project,'organization_id',wanted_organization);
  request_hash:=encode(extensions.digest(expected_values::text,'sha256'),'hex');
 else
  if p_expected is null or jsonb_typeof(p_expected)<>'object' or octet_length(p_expected::text)>524288
   or p_expected->>'id' is distinct from p_id::text or p_expected->>'user_id' is distinct from actor::text
   or jsonb_typeof(p_expected->'updated_at') is distinct from 'string' then raise exception 'Task invalid' using errcode='22023'; end if;
  if not isfinite((p_expected->>'updated_at')::timestamptz) then raise exception 'Task invalid' using errcode='22023'; end if;
  if (p_action='delete' and p_values<>'{}'::jsonb)
   or (p_action='toggle' and (not(p_values ? 'done') or (p_values-'done')<>'{}'::jsonb or jsonb_typeof(p_values->'done')<>'boolean')) then
   raise exception 'Task invalid' using errcode='22023';
  end if;
 end if;
 select * into source from public.todos where id=p_id and user_id=actor for update;
 existed:=found; source_json:=case when existed then to_jsonb(source) else null end;
 <<operation>>
 begin
  if p_action='create' then
   select * into receipt from dashboard_private.task_create_receipts where user_id=actor and task_id=p_id;
   receipted:=found;
   if receipted then
    if receipt.request_hash is distinct from request_hash then outcome:='conflict'; saved_json:=source_json; exit operation; end if;
    if not existed then outcome:='absent'; exit operation; end if;
    if source.created_at is distinct from receipt.created_at or source.done or
     exists(select 1 from unnest(fields) k where source_json->k is distinct from expected_values->k)
     or exists(select 1 from unnest(empty_fields) k where source_json->k is distinct from 'null'::jsonb) then
     outcome:='conflict'; saved_json:=source_json; exit operation;
    end if;
    outcome:='saved'; saved_json:=source_json; exit operation;
   end if;
   if existed then outcome:='conflict'; saved_json:=source_json; exit operation; end if;
   if (select count(*) from public.todos where user_id=actor)>=20000 then raise exception 'Task limit' using errcode='22023'; end if;
   stamp:=clock_timestamp();
   insert into dashboard_private.task_create_receipts(user_id,task_id,request_hash,created_at) values(actor,p_id,request_hash,stamp) returning * into receipt;
   if not found or receipt.user_id is distinct from actor or receipt.task_id is distinct from p_id or receipt.request_hash is distinct from request_hash or receipt.created_at is distinct from stamp then
    raise exception 'Task write unconfirmed' using errcode='40001';
   end if;
   insert into public.todos(id,user_id,title,due_date,importance,estimated_minutes,task_kind,is_global,project_id,organization_id,created_at,updated_at)
    values(p_id,actor,p_values->>'title',wanted_due,wanted_importance,wanted_minutes,p_values->>'task_kind',(p_values->>'is_global')::boolean,wanted_project,wanted_organization,stamp,stamp)
    returning * into saved;
   if not found then raise exception 'Task write unconfirmed' using errcode='40001'; end if;
   saved_json:=to_jsonb(saved);
   if saved.id is distinct from p_id or saved.user_id is distinct from actor or saved.done or saved.created_at is distinct from stamp or saved.updated_at is distinct from stamp
    or exists(select 1 from unnest(fields) k where saved_json->k is distinct from expected_values->k)
    or exists(select 1 from unnest(empty_fields) k where saved_json->k is distinct from 'null'::jsonb) then
    raise exception 'Task write unconfirmed' using errcode='40001';
   end if;
   select to_jsonb(r) into persisted from dashboard_private.task_create_receipts r where user_id=actor and task_id=p_id;
   if persisted is distinct from to_jsonb(receipt) then raise exception 'Task write unconfirmed' using errcode='40001'; end if;
   outcome:='saved';
  elsif not existed then outcome:='absent';
  elsif p_action='toggle' then
   expected_values:=(p_expected-'updated_at')||p_values;
   if (source_json-'updated_at')=expected_values and source.updated_at>=(p_expected->>'updated_at')::timestamptz then
    outcome:='saved'; saved_json:=source_json; exit operation;
   end if;
   if source_json is distinct from p_expected then outcome:='conflict'; saved_json:=source_json; exit operation; end if;
   update public.todos set done=(p_values->>'done')::boolean where id=p_id and user_id=actor returning * into saved;
   if not found then raise exception 'Task write unconfirmed' using errcode='40001'; end if;
   saved_json:=to_jsonb(saved);
   if (saved_json-'updated_at') is distinct from expected_values or saved.updated_at<=source.updated_at then
    raise exception 'Task write unconfirmed' using errcode='40001';
   end if;
   outcome:='saved';
  else
   if source_json is distinct from p_expected then outcome:='conflict'; saved_json:=source_json; exit operation; end if;
   delete from public.todos where id=p_id and user_id=actor returning * into saved;
   if not found or to_jsonb(saved) is distinct from source_json then raise exception 'Task write unconfirmed' using errcode='40001'; end if;
   if exists(select 1 from public.todos where id=p_id and user_id=actor) then raise exception 'Task write unconfirmed' using errcode='40001'; end if;
   outcome:='deleted';
  end if;
  if outcome='saved' then
   select to_jsonb(t) into persisted from public.todos t where id=p_id and user_id=actor;
   if persisted is distinct from saved_json then raise exception 'Task write unconfirmed' using errcode='40001'; end if;
  end if;
 end operation;
 result:=jsonb_build_object('kind',outcome,'ownerId',actor,'id',p_id,'task',saved_json);
 if octet_length(result::text)>524288 then raise exception 'Task limit' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function public.write_task(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.write_task(uuid,uuid,text,jsonb,jsonb) to authenticated;

reset lock_timeout;
