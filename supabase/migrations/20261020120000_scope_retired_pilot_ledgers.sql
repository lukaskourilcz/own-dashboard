-- #113: the October staging pilots are retired. Their ledger rows stay: windows, reservations, the
-- lifetime collection run and every reserved stage are retained, and no row is changed or removed.
-- What changes is how long a row blocks ordinary work. Each guard below now applies only while its
-- pilot window is unexpired, so an expired preview ledger cannot block production admission or
-- paid collection on the same database. During an unexpired window every interlock is unchanged.
-- A pilot tuple still can never open a second window or be replayed after expiry.

create or replace function marketing_private.check_generation_pilot(p_owner uuid,p_pilot jsonb,p_register boolean default false)
returns boolean language plpgsql set search_path='' as $$
declare config marketing_private.generation_pilots; starts timestamptz; expires timestamptz;
begin
 if p_owner is null then raise exception 'pilot owner required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'marketing-fixed-pilot',0));
 select * into config from marketing_private.generation_pilots where user_id=p_owner;
 if p_pilot is null then
  -- Only an unexpired window still requires its tuple; an expired row no longer blocks ordinary admission.
  if found and clock_timestamp()<config.expires_at then raise exception 'pilot configuration required'; end if;
  return false;
 end if;
 if jsonb_typeof(p_pilot)<>'object' or p_pilot - array['ownerId','startsAt','expiresAt'] <> '{}'::jsonb
  or (select count(*) from jsonb_object_keys(p_pilot))<>3 or p_pilot->>'ownerId' is distinct from p_owner::text
  or coalesce(p_pilot->>'startsAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
  or coalesce(p_pilot->>'expiresAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
 then raise exception 'pilot configuration invalid'; end if;
 starts:=(p_pilot->>'startsAt')::timestamptz; expires:=(p_pilot->>'expiresAt')::timestamptz;
 if expires<=starts or expires>starts+interval '48 hours' then raise exception 'pilot configuration invalid'; end if;
 if config.user_id is not null then
  if config.starts_at is distinct from starts or config.expires_at is distinct from expires then raise exception 'pilot configuration changed'; end if;
 elsif p_register then
  insert into marketing_private.generation_pilots values(p_owner,starts,expires);
 else raise exception 'pilot reservation required'; end if;
 -- Use wall-clock time after acquiring the lock, not the transaction start.
 if clock_timestamp()<starts or clock_timestamp()>=expires then raise exception 'pilot outside window'; end if;
 return true;
end $$;
revoke all on function marketing_private.check_generation_pilot(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function marketing_private.check_generation_pilot(uuid,jsonb,boolean) to service_role;

-- marketing_dneskai_admit and marketing_dneskai_claim_stage are redefined by more than one migration
-- (#112's 20261020100000 changes their Instagram limits and Jev planning). This file never restates
-- their bodies. It rewrites only the three pilot predicates inside whatever body is current, so it
-- composes with any earlier redefinition, and it stops if a predicate is not found exactly the expected
-- number of times. A body that already carries the scoped predicates is left alone, so a re-run changes
-- nothing. CREATE OR REPLACE keeps each function's owner and grants.
--
-- admit: the explicit-scope block holds only during an unexpired collection pilot, and ordinary admission
-- never returns the retained pilot run (the pilot side already refuses an ordinary run the same way).
-- claim_stage: an ordinary run is held from paid work only while a generation or collection pilot window
-- is unexpired. A pilot run keeps its immutable window and one-run limit; the unknown-cost guard is unchanged.
do $patch$
declare patch record; definition text; unscoped_count integer; scoped_count integer;
begin
 for patch in select * from (values
  ('public.marketing_dneskai_admit(uuid,uuid,date,jsonb)'::regprocedure,
   $unscoped$if exists(select 1 from marketing_private.dneskai_collection_pilots where user_id=p_owner) then raise exception 'collection pilot explicit scope required';end if;$unscoped$,
   $scoped$if exists(select 1 from marketing_private.dneskai_collection_pilots where user_id=p_owner and clock_timestamp()<expires_at) then raise exception 'collection pilot explicit scope required';end if;$scoped$,
   1),
  ('public.marketing_dneskai_admit(uuid,uuid,date,jsonb)'::regprocedure,
   $unscoped$if found then return to_jsonb(r);end if;$unscoped$,
   $scoped$if found then if r.collection_pilot_owner is not null then raise exception 'collection pilot existing daily run';end if;return to_jsonb(r);end if;$scoped$,
   2),
  ('public.marketing_dneskai_claim_stage(uuid,uuid,uuid,text,boolean)'::regprocedure,
   $unscoped$elsif exists(select 1 from marketing_private.generation_pilots where user_id=p_owner) or exists(select 1 from marketing_private.dneskai_collection_pilots where user_id=p_owner) then raise exception 'collection paid pilot blocked';end if;$unscoped$,
   $scoped$elsif exists(select 1 from marketing_private.generation_pilots where user_id=p_owner and clock_timestamp()<expires_at) or exists(select 1 from marketing_private.dneskai_collection_pilots where user_id=p_owner and clock_timestamp()<expires_at) then raise exception 'collection paid pilot blocked';end if;$scoped$,
   1)
 ) as p(fn,unscoped,scoped,expected) loop
  definition:=pg_get_functiondef(patch.fn);
  unscoped_count:=(length(definition)-length(replace(definition,patch.unscoped,'')))/length(patch.unscoped);
  scoped_count:=(length(definition)-length(replace(definition,patch.scoped,'')))/length(patch.scoped);
  if unscoped_count=0 and scoped_count=patch.expected then continue; end if;
  if unscoped_count<>patch.expected or scoped_count<>0 then
   raise exception 'pilot predicate in % not found as expected (% unscoped, % scoped, % wanted)',patch.fn,unscoped_count,scoped_count,patch.expected;
  end if;
  execute replace(definition,patch.unscoped,patch.scoped);
 end loop;
end $patch$;
