-- Owner decision 17 (22 October 2026): an unknown collection cost blocks paid work only on its own run
-- and its own Prague day. Until now marketing_dneskai_claim_stage refused every paid stage while any
-- stage the owner ever reserved had no cost or a cost above its reservation, so one unknown Apify cost
-- left by the retired October staging pilot blocked paid collection on every later night.
--
-- The guard now looks at the stages of the run being claimed and of every run with that run's date
-- (the claim already requires that date to be today in Prague). An unknown cost on another project's
-- run tonight still blocks tonight's paid work. An older unknown cost no longer blocks anything.
--
-- No row changes. The old reservation and its missing cost stay exactly as they are and still count
-- in their own day's $0.25 total. Every Apify stage keeps its $0.04 reservation and actor
-- maxTotalChargeUsd 0.04, and each Prague day keeps its $0.25 ceiling, so an unknown cost from an
-- earlier day is bounded by that day's ceiling, which this migration does not touch.
--
-- marketing_dneskai_claim_stage has more than one definition (20261021122104 and the pilot scoping in
-- 20261021122330). Like 20261021122330, this file does not restate the body: it rewrites only the one
-- guard inside whatever body is current, stops if the guard is not found exactly once, and leaves an
-- already rewritten body alone, so a re-run changes nothing. CREATE OR REPLACE keeps owner and grants.
do $patch$
declare definition text; unscoped text; scoped text; unscoped_count integer; scoped_count integer;
begin
 unscoped:=$unscoped$if exists(select 1 from public.marketing_dneskai_stages where user_id=p_owner and reserved_usd>0 and (cost_usd is null or cost_usd>reserved_usd)) then raise exception 'collection cost unresolved';end if;$unscoped$;
 scoped:=$scoped$if exists(select 1 from public.marketing_dneskai_stages st join public.marketing_dneskai_runs ru on ru.id=st.run_id where st.user_id=p_owner and st.reserved_usd>0 and (st.cost_usd is null or st.cost_usd>st.reserved_usd) and (st.run_id=p_run or ru.date=r.date)) then raise exception 'collection cost unresolved';end if;$scoped$;
 definition:=pg_get_functiondef('public.marketing_dneskai_claim_stage(uuid,uuid,uuid,text,boolean)'::regprocedure);
 unscoped_count:=(length(definition)-length(replace(definition,unscoped,'')))/length(unscoped);
 scoped_count:=(length(definition)-length(replace(definition,scoped,'')))/length(scoped);
 if unscoped_count=0 and scoped_count=1 then return; end if;
 if unscoped_count<>1 or scoped_count<>0 then
  raise exception 'unresolved-cost guard in marketing_dneskai_claim_stage not found as expected (% unscoped, % scoped)',unscoped_count,scoped_count;
 end if;
 execute replace(definition,unscoped,scoped);
end $patch$;
