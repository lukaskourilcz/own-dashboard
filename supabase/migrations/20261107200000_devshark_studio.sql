-- devShark studio (owner request, 7 November 2026): the owner edits a concept's slides and caption, sees it rendered
-- again and approves the new version. A save always returns the concept to `draft`, so an approval binds exactly the
-- saved text; a concept already in the plan or published cannot change. The studio tab joins the hideable tabs.

create function public.marketing_devshark_save(p_draft uuid,p_title text,p_deck jsonb,p_caption text)
returns text language plpgsql security definer set search_path='' as $$
declare d public.marketing_devshark_drafts;
begin
 select * into d from public.marketing_devshark_drafts where id=p_draft and user_id=(select auth.uid()) for update;
 if not found then raise exception 'draft unavailable'; end if;
 if d.status not in ('draft','approved','rejected') then raise exception 'draft already planned'; end if;
 update public.marketing_devshark_drafts set title=p_title,deck=p_deck,caption=p_caption,status='draft',decided_at=null,updated_at=clock_timestamp() where id=d.id;
 return 'draft';
end $$;
revoke all on function public.marketing_devshark_save(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_devshark_save(uuid,text,jsonb,text) to authenticated;

alter table public.user_preferences
  drop constraint if exists user_preferences_hidden_project_tabs_check;

alter table public.user_preferences
  add constraint user_preferences_hidden_project_tabs_check
  check (
    hidden_project_tabs <@ array[
      'overview',
      'tasks',
      'activity',
      'communication',
      'repository',
      'finance',
      'competition',
      'knowledge',
      'sources',
      'scaling',
      'monetization',
      'dneskai-review',
      'dneskai-calendar',
      'dneskai-published',
      'dneskai-costs',
      'dneskai-today',
      'devshark-studio'
    ]::text[]
  );
