-- Organization tax-registry verification: ARES fill provenance and the cached
-- VIES verdict.
--
-- * ares_verified_at records when the row was last filled from the ARES
--   ekonomicke-subjekty service, so a registry address is distinguishable from
--   a typed one.
-- * vat_verification_status, vat_verified_at and vat_verified_id hold the
--   cached VIES answer. vat_verified_id is the normalized VAT id the verdict
--   belongs to, so editing vat_id invalidates the cache instead of silently
--   carrying an answer for a different number.
-- * vat_verified_name and vat_verified_address keep what VIES returned, which
--   is what makes a name mismatch visible on the invoice buyer block.
--
-- Columns only: no table, no policy, no grant and no function of any kind. The
-- four own-only organizations policies and the existing service-role grants
-- already cover the new columns, so RLS is unchanged.

alter table public.organizations
  add column if not exists ares_verified_at timestamptz,
  add column if not exists vat_verification_status text not null default 'unchecked'
    check (vat_verification_status in ('unchecked', 'valid', 'invalid', 'unavailable')),
  add column if not exists vat_verified_at timestamptz,
  add column if not exists vat_verified_id text,
  add column if not exists vat_verified_name text,
  add column if not exists vat_verified_address text;

comment on column public.organizations.ares_verified_at is 'When the legal name and address were last filled from the ARES economic-subject register.';
comment on column public.organizations.vat_verification_status is 'Cached VIES verdict: unchecked, valid, invalid, or unavailable when a member state did not answer.';
comment on column public.organizations.vat_verified_at is 'When the cached VIES verdict was obtained.';
comment on column public.organizations.vat_verified_id is 'Normalized VAT id the cached verdict belongs to. A different vat_id invalidates the cache.';
comment on column public.organizations.vat_verified_name is 'Registered name VIES returned, kept so a mismatch with the invoice buyer name stays visible.';
comment on column public.organizations.vat_verified_address is 'Registered address VIES returned.';
