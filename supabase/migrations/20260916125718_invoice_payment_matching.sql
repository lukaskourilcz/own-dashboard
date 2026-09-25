-- Pair incoming bank payments with issued invoices.
--
-- `transactions.invoice_id` has existed since
-- 20260721165419_professional_restructure_core.sql and the insert/update
-- policies already verify that the referenced invoice belongs to the caller —
-- but nothing ever wrote the column. This migration adds the three fields the
-- matcher needs and leaves the existing policies untouched, because no new
-- foreign reference is introduced.
--
-- `variable_symbol` is the Czech payment reference (variabilní symbol) carried
-- on the bank side. GoCardless folds remittance text into `note`, so the column
-- is filled at ingest when the bank sends something structured and the matcher
-- falls back to parsing `note` for rows that predate it. Digits only, at most
-- ten, which is what the SPAYD/QR Platba spec allows.
--
-- `matched_at` and `match_source` record how a link happened: 'auto' for the
-- deterministic matcher (variable symbol + amount inside the invoice's own
-- rounding tolerance) and 'manual' for the owner linking a leftover payment by
-- hand from the unmatched-payments card. A link with no `matched_at` is a row
-- that was filed before this feature existed.
--
-- Two partial indexes: the unmatched-income scan the matcher runs, and the
-- reverse lookup the invoice list uses to show a paid invoice's payment.

alter table public.transactions
  add column if not exists variable_symbol text
    check (variable_symbol is null or variable_symbol ~ '^[0-9]{1,10}$'),
  add column if not exists matched_at timestamptz,
  add column if not exists match_source text
    check (match_source is null or match_source in ('auto', 'manual'));

create index if not exists transactions_unmatched_income_idx
  on public.transactions (user_id, occurred_on desc)
  where kind = 'income' and invoice_id is null;

create index if not exists transactions_invoice_idx
  on public.transactions (user_id, invoice_id)
  where invoice_id is not null;

comment on column public.transactions.variable_symbol is 'Czech payment reference (variabilní symbol), digits only, max 10. Captured at ingest; the matcher falls back to parsing note.';
comment on column public.transactions.matched_at is 'When this payment was linked to an invoice. Null for rows filed before payment matching existed.';
comment on column public.transactions.match_source is 'How the invoice link happened: auto (deterministic matcher) or manual (owner linked it).';
