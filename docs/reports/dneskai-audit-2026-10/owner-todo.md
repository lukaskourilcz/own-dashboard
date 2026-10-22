# What I need from you

State on 22 October 2026, after `own-dashboard` main `ecb9716` went live. All the building I could do without you is done. What remains below needs your hands, your accounts or your opinion.

Each item says how long it takes and what it costs. Where you have to choose, I put my recommendation first so you can answer "yes, your pick" if you agree.

---

## 1. Do today: DNESKAi can't post anything until you do these two

### Connect `@dneskai` to Instagram publishing (about 45 min, free)

The system has never seen your Instagram account. Production has 0 account rows, so each day's four prepared posts expire one by one without a draft.

1. Make `@dneskai` a Business or Creator account.
2. Give it a tester role on the Meta app (Development mode, Instagram Login).
3. Generate the 60-day token and put the values into Vercel Production. The exact names are in `docs/external-setup.md` §11.
4. Redeploy, then open DNESKAi → Zdroje and press **Ověřit účet**.

Publishing stays off after this. You switch it on later, only for the pilot post.

### Add the Anthropic key (5 min, then about $0.02 per post)

In Vercel Production, add `ANTHROPIC_API_KEY` (mark it Sensitive) and redeploy. Leave the model setting empty; it defaults to Claude Sonnet 5.5. Spending can't pass the $1 per day ceiling that's already set.

Once both are done, the next night's stories turn into real drafts you can open in the Design Lab.

---

## 2. Quick decisions (about 30 min for all of them)

Answer these in any form, even "1a, 2 yes, 3 no". Nothing here costs money unless it says so.

### How DNESKAi sounds
1. **Writing style.** a) calm plus a hook on the cover (my pick, to test), b) calm as today, c) explainer style. All three keep the truth rules. Examples: `docs/reports/dneskai-audit-2026-10/research/carousel-playbook.md`.
2. **Hashtags.** Instagram has allowed only 5 per post since 18 December 2025, but the code still adds up to 10. Cut to 5? (my pick: yes)

### Design
3. **The four other design kits.** Editorial works. Bold, Explainer, Magazine and Ticker exist only as copies of Editorial. Who designs them: you, me from the research, or a designer?
4. **Kit name.** Your notes said "clipping". The design record calls the fifth kit "magazine". Is "magazine" right?
5. **Where the studio code lives.** a) Keep Quorum as the source for now (my pick), b) move the whole studio into OwnDashboard, c) copy only the DNESKAi part.

### Reviewing and approving
6. **Moving a post to another time.** Today any time change needs a fresh approval. a) Keep it that way, and when a post misses its slot show "přesunuto, znovu schválit" with a one-tap re-approval (my pick). b) Let you move an approved post without re-approving.
7. **Reminder.** a) An in-app notification when the day's first post is ready and again 60 minutes before the first unapproved slot (my pick). b) No reminder.
8. **"Přegenerovat s poznámkou".** A button that rewrites a returned post using your note, about $0.02 each time. Build it? (my pick: yes)
9. **"Vygenerovat hned".** A button that drafts a story right away instead of waiting up to 5 minutes for the scheduler. Still under the $1 per day ceiling. Build it? (my pick: yes)
10. **Design Lab location.** a) Keep it inside the review tab (my pick, no database change). b) Give it its own tab.

### Which stories get picked
11. **Tool and ai-project as one category.** Today one weak "ai-project" item can push out a strong news story. Merge the two into one slot? (my pick: yes)
12. **Diversity or relevance.** a) Keep one story per category, then relevance (today). b) Pick by relevance first, allowing at most one non-news story a day (my pick).
13. **Held stories.** Should stories that Jev held get one automatic second chance the next night? It adds a tiny Jev cost, well under a cent. (my pick: yes)
14. **Similar headlines.** "Llama 4 8B" and "Llama 4 70B" count as one story. Keep that? (my pick: yes, it's usually one release)

### Money guards
15. **Reservation per draft.** The system blocks $0.25 before every model call, while a real call costs about $0.02. a) Lower it to about $0.13 (my pick), b) keep $0.25.
16. **Refused calls.** When the model provider refuses a call outright, count it as $0 instead of $0.25? (my pick: yes)
17. **Old unknown costs.** One old unknown Apify cost from staging can block paid work. Check only today's run instead of all history? (my pick: yes. The old reservation itself stays untouched, as you asked.)
18. **Dates as evidence.** Should a number that only appears in a date (the "22" in "22. 10. 2026") count as proof for "22 %"? (my pick: no)

### Small follow-ups
19. A retried draft keeps the model's first answer on the job, which only you and the system can read. Keep it? (my pick: yes, it makes the retry better)
20. When you add a picture slide yourself, should its source also appear as a thumbnail on the sources slide? (my pick: no, the credit line is enough)
21. **Agency photos.** A Getty photo was credited "Obrázek: TechCrunch". a) Credit both when the file shows the agency: "Foto: Getty Images přes TechCrunch" (my pick). b) Keep crediting the publisher only.

---

## 3. Apify money (your $150 credit, expires about 22 November)

### Turn on Instagram as a source (5 min, a few cents a night)
Set `MARKETING_DNESKAI_APIFY_ENABLED=true` in Vercel. Instagram profiles give the most multi-picture material. The existing caps stay: $0.04 per profile and $0.25 per day. My pick: yes.

### Approve the research plan (30 min to read, up to $126)
The plan studies how AI and tech accounts post (formats, captions, timing, music) in four waves from 23 October to 21 November. Each run has its own cap and the plan stops at $126. Read `docs/dneskai-apify-research.md`, then tell me:
- approve the plan as it is, or what to change;
- collect comments: yes or no (they contain private usernames; my pick: no).

It also needs one database change (see section 4) before it can run.

Don't cancel the Apify subscription, even though an old Quorum note suggests it. DNESKAi and this credit depend on it.

---

## 4. One database session (about 30–45 min, best done together)

Production recorded its database changes under different version numbers than the repository. Until that list is lined up, no new database change can go in safely. Eight prepared changes are waiting, and the features that need them stay hidden behind switches.

Tell me "go" and I'll prepare the exact commands. You run them, because they write to production.

1. **Line up the migration history.** I prepare the commands; you approve and run them.
2. **Run the two cleanup statements** that trim old scheduler logs. Until then the daily run logs one harmless error.
3. **Apply the eight waiting changes.** They unlock:
   - "Give up and queue again" for a stuck Instagram publication;
   - "Re-review" for held stories and "Move to next free slot" and "Release" for expired posts;
   - richer article text in the stories;
   - better category picking;
   - the Apify research ledger.
4. **Flip the matching switches in Vercel and redeploy.** I'll give you the list.

---

## 5. When the basics work

### Pilot post (20 min, at most $1.50)
After section 1: open the Design Lab, edit and approve one post, switch publishing on for `@dneskai` only, check that it appears on Instagram and in Publikované, then switch publishing off again.

### LangSmith diagnostics (20 min, free tier)
Create a project in an EU LangSmith workspace and add four values to Vercel. The exact steps are in `NEEDED.md`. You'll then see a privacy-safe trace for every draft.

### Model comparison (later, about $3 in total)
After 20 approved posts, compare Sonnet with Haiku on the same stories. It runs only with your OK.

---

## 6. Something you can do on the sofa: label 94 stories (about 1 hour)

`dneskai-audit-handoff/jev-eval/candidates.csv` (on Lukáš's Mac, outside the repository) lists 94 real candidate stories. For each, fill in the right category, whether it belongs on DNESKAi (y/n), and whether it repeats another row. Don't open `jev-predictions.csv` first. Then run `python3 -I scripts/score.py labelled.csv`. That tells us how often Jev picks well.

---

## 7. Cleanup (30 min, when convenient)

- **n8n:** archive three old DNESKAi workflows and rename three staging credentials with a `RETIRED` prefix. After the pilot, delete them, plus the old Preview variables and the `codex/marketing-automation` branch. The names are in `docs/marketing-staging-retired-2026-10.md`. Deleting can't be undone.
- **Scheduler secret (optional, 10 min):** a session generated it, so replace it if you want one nobody else has seen. Steps are in `NEEDED.md`.

---

## 8. Outside DNESKAi

- **Oslo applications (30 min):** review the drafts before sending.
- **Finances (40 min):** compare subscription amounts and dates with real invoices, confirm the Claude Max charges for June and July, and check how project costs are split.
- **devShark:** the weekly import and the channel connections wait on your approval of the Story layout and the live import scope (`docs/marketing-weekly-operations.md`).
- **Instagram Saved export:** download it when you want the knowledge backfill (#101).
- **Threads:** a later expansion, waiting on a Threads account (#124).

---

## What I'll do without you

On 23, 25 and 28 October I'll check (read-only) that the GitHub, StackExchange and arXiv feeds now work in production, if you start a session or let me schedule it.
