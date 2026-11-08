# DNESKAi series

Owner decisions of 8 November 2026. Six recurring series run next to the news and the ordinary education
topics. Each one posts at least twice a week, from 16 November 2026, on the two daytime slots that post on
Instagram and Threads. 08:00 and the Threads post at 20:00 stay with the news every day, and so does Sunday 17:00.

| Day | 12:30 | 17:00 |
|---|---|---|
| Monday | Slovník AI | Karpathy |
| Tuesday | Mosseri | Cherny |
| Wednesday | Slovník AI | Mollick |
| Thursday | Mosseri | Pocock |
| Friday | Slovník AI | Karpathy |
| Saturday | Cherny | Mollick |
| Sunday | Pocock | news |

| Series | Label | Backlog |
|---|---|---|
| `explainer` | Slovník AI #N | `content/dneskai-series/explainers.json`, 30 terms |
| `mosseri` | Tipy od šéfa Instagramu Mosseriho #N | `content/dneskai-series/mosseri.json` |
| `karpathy` | Tipy od leadera vibecodingu Karpathyho #N | `content/dneskai-series/karpathy.json` |
| `cherny` | Tipy od tvůrce Claude Code Borise Chernyho #N | `content/dneskai-series/cherny.json` |
| `mollick` | Tipy profesora AI Ethana Mollicka #N | `content/dneskai-series/mollick.json` |
| `pocock` | Tipy Matta Pococka na AI skills #N | `content/dneskai-series/pocock.json` |

## How a series post is made

1. **Topic.** A series post is an education topic (`marketing_dneskai_topics`, `source_kind` `manual`) with
   `evidence.series`, `evidence.seriesOrder` and up to three `evidence.urls`. It is proposed; the owner approves it in
   Náměty, where it shows its series badge. Every tip is a paraphrase with the person named as the speaker. The URLs
   stay in the database; the post names no source (owner rule of 22 October 2026, confirmed for the series).
2. **Plan.** `fillPlan` (`dneskai-plan.ts`) seats approved series topics in their series' slots in `seriesOrder`, even
   at 17:00, which is otherwise a news time. A series slot without a topic stays free until the plan prepares that day
   (today and two days ahead), then an ordinary topic takes it. The night's news never takes a series slot.
3. **Sources and pictures.** The topic bridge reads every URL through Jina Reader. The first page, led by the topic's
   own summary, is the brief's lead; the others are further members, so their pictures are collected too. An
   owner link always gets two Pexels photos (`MARKETING_DNESKAI_STOCK_ENABLED`, `PEXELS_API_KEY`), because a
   documentation page often has only a logo or text, which Claude vision drops. When nothing usable is left, one
   illustration comes from fal's Seedream 4.5 (`MARKETING_DNESKAI_GENERATED_ENABLED`, `FAL_API_KEY`, $0.04 each,
   at most `DNESKAI_GENERATED_PER_DAY` a day, default 6).
4. **Copy.** Generation follows `DNESKAI_STYLE_RULES` (`docs/dneskai-style-guide.md`): no question in the title or on
   the cover, a hook and then the plain statement.
5. **Number and label.** Before approval the plan writes the heading, for example „Slovník AI #3“, on the cover
   (`series` on the cover slide, drawn by Spotlight and Plakát) and as the first caption line, which the
   Threads post keeps. The number counts the series' published posts, then the coming ones in slot order. A post
   skipped or failed before publication gets no number, so there is no gap. An approved post whose number changed is
   renumbered while its slot is at least 30 minutes away.

## Refilling a backlog

At two posts a week a 30-tip backlog lasts about 15 weeks. The default refill involves no paid automation: once a week
a Claude Code session researches the person's latest public posts, verifies every claim on a real page, paraphrases
the tip, appends it to the series' JSON file and inserts it as a proposed topic. A fully automatic refill in the tick
would need new paid calls (Apify and Claude) and a new cost cap, so it waits for the owner's decision (backlog item).
