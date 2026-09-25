-- Development finance: which subscription figures were read from an invoice.
--
-- The 2026-09-16 import was built from Gmail receipts. Some receipts did not
-- state a figure, so the amount came from a renewal notice or a price change
-- and the caveat was written into `subscriptions.notes` as free text. Free text
-- cannot be counted, so the Money overview had no way to say how much of the
-- recurring total rests on an amount nobody has checked against an invoice.
--
-- `amount_confirmed_on` is that record: the date the owner last compared this
-- subscription's amount, currency and billing cycle against the vendor's own
-- invoice. Null means "not checked", which is the honest state of every row
-- that exists before this migration runs — nothing is back-filled, because only
-- the owner knows which figures they have actually verified.
--
-- The confirmation covers one figure. The application clears it when the
-- amount, currency or billing cycle changes, so a stale confirmation cannot
-- vouch for a number it was never given for.
--
-- No new foreign reference, so the existing own-only subscription policies
-- still cover every path to this column and no policy is rewritten here.

alter table public.subscriptions
  add column if not exists amount_confirmed_on date;

comment on column public.subscriptions.amount_confirmed_on is 'Date the owner last confirmed this subscription''s amount, currency and billing cycle against the vendor invoice. Null = never confirmed; cleared by the application when the figure changes.';
