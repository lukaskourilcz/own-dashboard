-- devShark concept generation (owner decision, 7 November 2026): Claude writes new concepts that wait for the owner's
-- approval in the studio. Each generated concept records what its call cost, so the scheduler keeps the last 24 hours
-- under the daily devShark ceiling before it starts another call.

alter table public.marketing_devshark_drafts
  add column cost_usd numeric(10,6) check (cost_usd is null or cost_usd >= 0);
create index marketing_devshark_drafts_generated on public.marketing_devshark_drafts(user_id,created_at) where origin='generated';
