-- The phone-app product is called heyDarlink (owner request, 8 November 2026). The portfolio registry never renames a
-- row, so the stored name changes here, only while it is still the old one.
update public.projects set name='heyDarlink',updated_at=now() where portfolio_key='phone-app' and name='LINKA';
