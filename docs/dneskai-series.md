# DNESKAi series

Owner decisions of 8 November 2026. Six recurring series run next to the news and the ordinary education
topics. Each one posts at least twice a week, from 16 November 2026, on the two daytime slots that post on
Instagram and Threads. 08:00 and the Threads post at 21:00 stay with the news every day, and so does Sunday 19:00.

| Day | 12:30 | 19:00 |
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
   at 19:00, which is otherwise a news time. A series slot without a topic stays free until the plan prepares that day
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

## Refilling the stock automatically

Owner decision of 8 November 2026: the series refill themselves in waves, with no manual approval. A Vercel cron
calls `GET /api/cron/dneskai-series-refill` every day at 04:15 UTC (`vercel.json`, `CRON_SECRET`). The job runs
`runDneskaiSeriesRefill` (`src/lib/marketing/dneskai-series-refill-run.ts`), with the pure rules in
`dneskai-series-refill.ts`.

1. **Stock check, free.** The stock is every approved series topic that is not seated yet or is seated for today or
   later. Each series is counted in days at its posts a week: three for Slovník AI, two for the others. While every
   series has at least 14 days, the job stops with `series-stock-covered` and pays for nothing.
2. **One wave per two weeks.** The wave ledger (`marketing_private.dneskai_series_waves`, migration
   `20261109010000`) admits a wave only when no wave started in the last 12 days, a failed one included. A broken
   wave therefore cannot retry every day. The wave reserves its whole cap first: `MARKETING_DNESKAI_SERIES_WAVE_USD`,
   default $1.50, at most $5, for Apify and Claude together. It fills every series up to 28 days, at most 8 new tips
   per series, so two weeks later the next wave still finds two weeks in stock.
3. **Apify, prepaid credit only.** Before any run the job reads the account's usage and limits
   (`/v2/users/me/limits`, `/v2/users/me`). Apify gets at most 40 % of the wave cap, and never more than the prepaid
   credit the plan includes minus this cycle's usage. With no headroom (`series-apify-no-prepaid-headroom`) or no
   `APIFY_TOKEN`, no run starts and the wave goes on with the free pages. There are two runs, each with
   `maxTotalChargeUsd`:
   - `apidojo~tweet-scraper` for the X posts of Karpathy, Cherny, Mollick and Pocock in the last 60 days;
   - `futurizerush~meta-threads-scraper` for Mosseri's Threads posts.

   A run that is still going at the deadline is aborted. A cost Apify does not report counts at the run's full cap.
4. **Free pages.** The speakers' own pages go through Jina Reader: Karpathy's blog, Mollick's One Useful Thing and
   Pocock's AI Hero. For Slovník AI, one small Claude call names new terms with their English Wikipedia article,
   which Jina then reads. `DNESKAI_SERIES_SOURCES` lists the handles and pages.
5. **Drafts.** For each series, one Claude Sonnet 5.5 call writes tips from that text, following the house style and
   the post rules. A call starts only when its predicted cost still fits the wave cap.
6. **Gates, then approval.** Code checks every draft (`dneskaiSeriesDraftIssues`). A draft that passes is inserted as
   an approved series topic with the next `seriesOrder`, `approvedBy: dneskai-series-refill` and the wave id. A draft
   passes when:
   - its quote of at least 40 characters stands word for word in the named source of the same series, and the
     source's page was not used before;
   - the title is a statement without a question mark;
   - title and summary carry no source, link, handle or hashtag;
   - a creator tip names its speaker;
   - it repeats no title, keyword or slug of the series.

   Every dropped draft is counted by its code in the answer. The plan then seats approved topics as before.
7. **Settle.** The wave records its Apify and Claude cost, the number inserted and its code.

Switches: `MARKETING_DNESKAI_SERIES_REFILL_ENABLED=false` stops the job. It is on by default because the owner
decided it should run unattended. The job also needs `MARKETING_OWNER_ID`, `MARKETING_AI_CONSENT=true` and
`ANTHROPIC_API_KEY`. Without them it stops before reserving a wave (`series-model-unconfigured`). The answer and
the log carry counts, codes and costs only.

The JSON files in `content/dneskai-series/` hold the hand-made first tips. Tips added by a wave live only in the
database. A Claude Code session may still add tips by hand the old way: research, verify, paraphrase, append to the
JSON and insert the topic.
