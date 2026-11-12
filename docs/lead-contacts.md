# Lead contacts: import and new trades

Opportunities → Contacts shows the tradespeople you offer a website with a booking form to. A collection run writes them to `~/Developer/leads-data/<trade_slug>/contacts.json` in the format of `~/Developer/leads-data/CONTRACT.md`. `scripts/import-lead-contacts.ts` moves that file into Supabase.

## Run the import

From a checkout of `main`:

```sh
npm ci                     # once per checkout
npm run import:leads -- hodinovy-manzel "Hodinový manžel" --dry-run
npm run import:leads -- hodinovy-manzel "Hodinový manžel"
```

The dry run validates the file and prints the counts without connecting to Supabase. The real run prints how many contacts were new, updated, and left alone because you marked them "Nekontaktovat".

The script reads `.env.local` in the checkout (or the shell environment):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://gcctapykhrdyxikieemn.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the service role key from Supabase → Project Settings → API Keys. Vercel stores it as a secret, so `vercel env pull` leaves it empty. |
| `DASHBOARD_OWNER_ID` | optional while the dashboard has one account |

`--dir <path>` reads another data folder instead of `~/Developer/leads-data`.

## What the import keeps

The import matches by trade and e-mail (lowercased). For a contact that already exists it replaces the collected data: name, phone, website, form status, score and reason, activity, city, region, IČO, sources and collection date. It never changes your outreach status, last-contacted date or note. A contact you marked "Nekontaktovat" stays exactly as it is. Contacts missing from a newer file stay in the table.

The whole file is checked before anything is written. A bad record (missing e-mail source, a score without a website, a region spelled differently from the 14 in the contract, a repeated e-mail) stops the run with a list of the problems.

## Add a trade

Collect into `~/Developer/leads-data/<new-slug>/contacts.json` with `"trade": "<new-slug>"` on every record, then run the import with the new slug and its display name. The first run adds the trade to the selector. Write its template under Opportunities → Emails; until then, **Write** on a contact says the template is missing. No migration or code change is needed.

## The template

The template lives in `lead_email_templates`, one per trade, and you edit it in Opportunities → Emails. The sender address and signature are part of the text, so changing the address needs no deploy. Variables: `{{jmeno}}`, `{{mesto}}`, `{{kraj}}`, `{{web}}`, `{{duvod}}`, `{{cinnost}}`, `{{zdroj}}`, `{{zdroj_url}}`. `{{#web}}…{{/web}}` shows its text only when the contact has a website, `{{^web}}…{{/web}}` only when it has none; this works for every variable.
