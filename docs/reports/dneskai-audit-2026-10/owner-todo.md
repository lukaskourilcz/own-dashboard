# What I need from you

> **Superseded on 23 October 2026.** This list is a snapshot from the evening of 22 October. Since then the pilot has published, 23 migrations wait instead of 13, and the education and Reels plan added new owner steps. The current list is [`NEEDED.md`](../../../NEEDED.md).

Updated after browser setup on 22 October 2026. See [verified setup and exact continuation point](browser-setup-result.md). Product decisions below remain pending; setup completion does not prove the live publication chain.

Each item says how long it takes and what it costs. Where you have to choose, I put my recommendation first so you can answer "yes, your pick" if you agree.

---

## 1. Setup and publishing activation complete

Production Anthropic key: **set**. @dneskai is a Creator account, tester invitation accepted, six Instagram configuration values set, redeploy Ready and Sources verification successful at 16:17 Prague on 22 October. The owner explicitly retained all five scopes granted by Meta. Token expires 21 December 2026 at 15:07:44 Prague.

The owner requested publishing activation for testing and completed Vercel email verification. Both Production switches are now true, deployment `61NBJAaMqE9bmfTYHZwHZeeDUsUS` is Ready, and Sources shows @dneskai verified, publishing enabled and a valid token. No final post has been approved or published.

The [setup report](browser-setup-result.md) records app IDs, deployment, scopes, expiry and the exact resume steps. Do not recreate the key or app.

---

## 2. Decisions: all made on 22 October 2026

You approved every recommendation ("yes, all my picks"), plus the post rules and the hashtag cap you set the same evening. All of it is built on branch `fable/dneskai-kit-plumbing`:

- **How DNESKAi sounds.** Calm register with a factual hook on the cover. Up to 10 hashtags, `#dneskai` first.
- **Post rules.** The first slide shows only its headline. No slide shows page numbers, picture credits, a sources slide or anything about sources. The caption names no sources or credits. These rules live in `.claude/skills/dneskai-post-content/SKILL.md`.
- **Design.** Six kits are designed and selectable in the Design Lab: Editorial, Bold, Explainer, Magazine, Ticker and Spotlight. Spotlight is the photo-led style from your reference, and its cover can add a round inset picture. The kit id stays `magazine`. Quorum remains the source of the studio. Every Spotlight headline is sentence case because a kit sets each field in one case; capital quotes would need a per-role case in the contract.
- **Reviewing and approving.** A time change still needs a new approval. A missed post shows "Přesunuto, znovu schválit" with one-tap re-approval to the next free slot. "Publikovat hned" approves for two minutes from now. Reminders go out as in-app notifications. "Přegenerovat s poznámkou" and "Vygenerovat hned" are built. The Design Lab stays in the review tab.
- **Which stories get picked.** Relevance first, at most one story outside AI and tech news a day, with tool, ai-project and marketing sharing that slot. Held stories get one automatic second review. "Llama 4 8B" and "Llama 4 70B" stay one story.
- **Money guards.** A draft reserves $0.13 instead of $0.25. A call the provider refuses before billing counts as $0. An old unknown cost blocks only its own night.
- **Small follow-ups.** A retry keeps the model's previous answer. An inserted picture slide gets no sources thumbnail. A photo agency is credited in the database as "Foto: Getty Images přes TechCrunch".

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

## 4. One database push (about 20 min)

The repository lists every migration version production recorded, so no history repair is needed. Thirteen prepared migrations wait, `20261022000000` through `20261022190000`. You run them because they need the database password and write to production:

1. Push them with the Supabase CLI, using the commands under "Applying the prepared migrations" in `docs/migration-guide.md`.
2. Set six switches to `true` in Vercel Production and redeploy: `DNESKAI_RICH_EVIDENCE_ENABLED`, `DNESKAI_OWNER_RECOVERY_ENABLED`, `DNESKAI_LAPSED_RELEASE_ENABLED`, `MARKETING_PUBLICATION_REQUEUE_ENABLED`, `DNESKAI_SELECTION_V2_ENABLED`, `DNESKAI_REGENERATE_ENABLED`.

This unlocks:
- the scheduler log cleanup;
- held re-review, reslot and release;
- "give up and queue again";
- richer article text;
- relevance-first selection and the second review of held stories;
- regenerate with a note;
- the narrower unknown-cost guard;
- the Apify research ledger, which spends nothing until you approve the plan.

## 5. When the basics work

### Pilot post (20 min, at most $1.50)
Publishing is already on for `@dneskai`, and two real posts reached review on 22 October. Open the Design Lab, check and edit the carousel, and approve it. It goes out in its slot. Check that it appears on Instagram and in Publikované, then switch publishing off again unless you want it daily. My review notes are in issue #123.

### LangSmith diagnostics (20 min, free tier)
Create a project in an EU LangSmith workspace and add four values to Vercel. The exact steps are in `NEEDED.md`. You'll then see a privacy-safe trace for every draft.

### Model comparison (later, about $3 in total)
After 20 approved posts, compare Sonnet with Haiku on the same stories. It runs only with your OK.

---

## 6. Something you can do on the sofa: label 94 stories (about 1 hour)

`dneskai-audit-handoff/jev-eval/candidates.csv` (on Lukáš's Mac, outside the repository) lists 94 real candidate stories. For each, fill in the right category, whether it belongs on DNESKAi (y/n), and whether it repeats another row. Don't open `jev-predictions.csv` first. Then run `python3 -I scripts/score.py labelled.csv`. That tells us how often Jev picks well.

---

## 7. Cleanup (30 min, when convenient)

- **n8n — completed 22 October:** three old DNESKAi workflows archived; three staging credentials renamed with a `RETIRED` prefix. After the pilot, delete them, plus the old Preview variables and the `codex/marketing-automation` branch. The names are in `docs/marketing-staging-retired-2026-10.md`. Deleting can't be undone.
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
