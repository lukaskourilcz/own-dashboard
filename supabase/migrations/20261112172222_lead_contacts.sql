-- Opportunities → Contacts and Emails (owner request, 12 November 2026).
--
-- Small Czech tradespeople the owner offers a website with a booking form to, one trade at a time. A new trade is
-- a new row in lead_trades plus a new data collection; the schema and the UI stay as they are.
--
-- lead_contacts is filled by scripts/import-lead-contacts.ts from ~/Developer/leads-data/<trade>/contacts.json
-- (format: leads-data/CONTRACT.md). The import upserts by (owner, trade, email) and never touches the owner's
-- outreach status, last-contacted date or note; a row the owner marked do_not_contact is not touched at all.
--
-- client_opportunities, opportunity_events and freelance_platforms stay in place (exported to docs/archive/);
-- nothing reads them any more.

create table public.lead_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug),
  unique (user_id, id)
);

create table public.lead_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trade_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_source_url text not null check (email_source_url ~ '^https?://'),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  website text check (website ~ '^https?://'),
  form_status text check (form_status in ('none', 'contact_form')),
  quality_score smallint check (quality_score between 1 and 10),
  quality_reason text,
  activity text not null default '',
  city text,
  region text check (region in (
    'Hlavní město Praha', 'Středočeský kraj', 'Jihočeský kraj', 'Plzeňský kraj', 'Karlovarský kraj',
    'Ústecký kraj', 'Liberecký kraj', 'Královéhradecký kraj', 'Pardubický kraj', 'Kraj Vysočina',
    'Jihomoravský kraj', 'Olomoucký kraj', 'Zlínský kraj', 'Moravskoslezský kraj')),
  ico text check (ico ~ '^[0-9]{8}$'),
  source text not null check (length(btrim(source)) > 0),
  source_url text check (source_url ~ '^https?://'),
  other_profiles text[] not null default '{}',
  collected_at date not null,
  outreach_status text not null default 'new'
    check (outreach_status in ('new', 'contacted', 'replied', 'interested', 'not_interested', 'do_not_contact')),
  last_contacted_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, trade_id) references public.lead_trades(user_id, id) on delete cascade,
  unique (user_id, trade_id, email),
  -- A contact without a website has no form status and no quality score; one with a website has a form status.
  check (
    (website is null and form_status is null and quality_score is null and quality_reason is null)
    or (website is not null and form_status is not null)
  )
);
create index lead_contacts_trade_status_idx on public.lead_contacts(user_id, trade_id, outreach_status);
create index lead_contacts_trade_region_idx on public.lead_contacts(user_id, trade_id, region);
create index lead_contacts_trade_quality_idx on public.lead_contacts(user_id, trade_id, quality_score);
create index lead_contacts_trade_name_idx on public.lead_contacts(user_id, trade_id, name);

-- One outreach template per trade, edited in Opportunities → Emails.
create table public.lead_email_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trade_id uuid not null,
  subject text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, trade_id) references public.lead_trades(user_id, id) on delete cascade,
  unique (user_id, trade_id)
);

-- Owner and creation time never change; updated_at follows every write. Moving a contact to "contacted" stamps
-- the last-contacted time unless the same write sets it.
create function public.lead_rows_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    if tg_table_name = 'lead_contacts'
      and new.outreach_status = 'contacted' and old.outreach_status is distinct from 'contacted'
      and new.last_contacted_at is not distinct from old.last_contacted_at then
      new.last_contacted_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.lead_rows_touch() from public, anon, authenticated;
create trigger lead_trades_touch before insert or update on public.lead_trades
  for each row execute function public.lead_rows_touch();
create trigger lead_contacts_touch before insert or update on public.lead_contacts
  for each row execute function public.lead_rows_touch();
create trigger lead_email_templates_touch before insert or update on public.lead_email_templates
  for each row execute function public.lead_rows_touch();

alter table public.lead_trades enable row level security;
alter table public.lead_contacts enable row level security;
alter table public.lead_email_templates enable row level security;
revoke all on public.lead_trades, public.lead_contacts, public.lead_email_templates from public, anon, authenticated;
grant select, insert, update, delete on public.lead_trades, public.lead_contacts, public.lead_email_templates to authenticated;
grant all on public.lead_trades, public.lead_contacts, public.lead_email_templates to service_role;

create policy "lead_trades select own" on public.lead_trades for select to authenticated using ((select auth.uid()) = user_id);
create policy "lead_trades insert own" on public.lead_trades for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "lead_trades update own" on public.lead_trades for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "lead_trades delete own" on public.lead_trades for delete to authenticated using ((select auth.uid()) = user_id);
create policy "lead_contacts select own" on public.lead_contacts for select to authenticated using ((select auth.uid()) = user_id);
create policy "lead_contacts insert own" on public.lead_contacts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "lead_contacts update own" on public.lead_contacts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "lead_contacts delete own" on public.lead_contacts for delete to authenticated using ((select auth.uid()) = user_id);
create policy "lead_email_templates select own" on public.lead_email_templates for select to authenticated using ((select auth.uid()) = user_id);
create policy "lead_email_templates insert own" on public.lead_email_templates for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "lead_email_templates update own" on public.lead_email_templates for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "lead_email_templates delete own" on public.lead_email_templates for delete to authenticated using ((select auth.uid()) = user_id);

-- The import. Only the service role runs it (scripts/import-lead-contacts.ts). p_owner may be null while the
-- dashboard has exactly one account. Returns {"trade_id", "inserted", "updated", "skipped_do_not_contact"}.
create function public.import_lead_contacts(p_owner uuid, p_trade_slug text, p_trade_name text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := p_owner;
  trade uuid;
  total integer := coalesce(jsonb_array_length(p_rows), 0);
  inserted integer;
  written integer;
begin
  if owner_id is null then
    if (select count(*) from auth.users) <> 1 then raise exception 'lead import owner required'; end if;
    select id into owner_id from auth.users;
  end if;
  insert into public.lead_trades(user_id, slug, name) values (owner_id, p_trade_slug, p_trade_name)
    on conflict (user_id, slug) do nothing;
  select id into trade from public.lead_trades where user_id = owner_id and slug = p_trade_slug;

  with incoming as (
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      name text, email text, email_source_url text, phone text, website text, form_status text,
      quality_score smallint, quality_reason text, activity text, city text, region text, ico text,
      source text, source_url text, other_profiles text[], collected_at date)
  ), upserted as (
    insert into public.lead_contacts as c (user_id, trade_id, name, email, email_source_url, phone, website,
      form_status, quality_score, quality_reason, activity, city, region, ico, source, source_url,
      other_profiles, collected_at)
    select owner_id, trade, i.name, lower(btrim(i.email)), i.email_source_url, i.phone, i.website, i.form_status,
      i.quality_score, i.quality_reason, coalesce(i.activity, ''), i.city, i.region, i.ico, i.source, i.source_url,
      coalesce(i.other_profiles, '{}'), i.collected_at
    from incoming i
    on conflict (user_id, trade_id, email) do update set
      name = excluded.name, email_source_url = excluded.email_source_url, phone = excluded.phone,
      website = excluded.website, form_status = excluded.form_status, quality_score = excluded.quality_score,
      quality_reason = excluded.quality_reason, activity = excluded.activity, city = excluded.city,
      region = excluded.region, ico = excluded.ico, source = excluded.source, source_url = excluded.source_url,
      other_profiles = excluded.other_profiles, collected_at = excluded.collected_at
    where c.outreach_status <> 'do_not_contact'
    returning (xmax = 0) as is_new
  )
  select count(*) filter (where is_new), count(*) into inserted, written from upserted;

  return jsonb_build_object('trade_id', trade, 'inserted', inserted, 'updated', written - inserted,
    'skipped_do_not_contact', total - written);
end $$;
revoke all on function public.import_lead_contacts(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_lead_contacts(uuid, text, text, jsonb) to service_role;

-- The first trade and the first version of its template, for the single owner.
insert into public.lead_trades(user_id, slug, name, sort_order)
select id, 'hodinovy-manzel', 'Hodinový manžel', 0 from auth.users
on conflict (user_id, slug) do nothing;

insert into public.lead_email_templates(user_id, trade_id, subject, body)
select t.user_id, t.id,
  '{{jmeno}}: web s objednáním termínu',
  $body$Dobrý den,

jmenuji se Lukáš Kouřil a dělám weby pro živnostníky.

{{#web}}Prošel jsem si váš web {{web}}. {{duvod}} Termín si na něm zákazník objednat nemůže.{{/web}}{{^web}}Vlastní web jsem k vám nenašel. Kdo hledá hodinového manžela na Googlu, najde vás jen v katalogu vedle konkurence.{{/web}}

Udělám vám web, na kterém si zákazník sám vybere termín a pošle vám, co potřebuje opravit. Nastavím ho tak, aby vás lidé z okolí našli na Googlu.

Váš e-mail jsem našel na {{zdroj_url}}.

Jestli o to nestojíte, stačí odpovědět „ne“ a už se neozvu.

Lukáš Kouřil
lukas@lukaskouril.dev
IČO: [doplnit]$body$
from public.lead_trades t where t.slug = 'hodinovy-manzel'
on conflict (user_id, trade_id) do nothing;
