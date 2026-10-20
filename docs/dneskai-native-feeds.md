# DNESKAi native free-feed migration

OwnDashboard can collect the existing 32 free feeds without calling Quorum. Select `MARKETING_DNESKAI_FEED_PROVIDER=native` in a reviewed deployment to use the local adapters. Unset or `bridge` keeps the existing signed collection bridge. An unknown value fails closed. This change sets no deployment variables. Verification: a live read-only comparison of all 32 feeds on 20 October 2026, described below.

The local registry preserves the exact feed IDs, URLs, search queries and GitHub repositories from Quorum. `dneskai-registry.ts` remains the authority for all 42 source identities and their Prague collection cadence; ten Instagram profiles retain the existing capped Apify path. The local adapter boundary returns `dneskai-feed/1`; the collection runner retains candidate hashes, partial statuses and its existing cursor rules. Research candidates still require classification and owner review.

## Provenance

The implementation copies the free-feed adapter code from `lukaskourilcz/quorum`, inspected local commit `55ab37924e51034f4ece8dd5dcdcdf41e5b5b6ed`:

- `orchestrator/src/sources/adapters/{rss,arxiv,hn,html,github,bluesky,spaceflight,stackexchange,index,util}.ts`
- `orchestrator/src/sources/types.ts`
- `orchestrator/src/security/{url,content}.ts`
- `config/sources.json`

OwnDashboard stores these files under `src/lib/marketing/free-feeds/`. The migration changes local import extensions, adds injected test transport/resolution and DNS-pinned HTTPS connections, rejects redirects, removes ambient GitHub and StackExchange credentials, and replaces reader fallbacks with a reader-disabled result. It retains bounded source projection and sanitization. `dneskai-native-feed.ts` applies the existing collection envelope and an exact configured source binding. Its additional checks reject future windows, unsafe item URLs, overlong IDs and detected source instruction text. Keep those differences when updating the copied adapters. `rss-parser@3.13.0` and `cheerio@1.2.0` support the same RSS/Atom and HTML parsing strategies.

## Boundaries and recovery

Requests use only the registered source's HTTPS host. The transport checks public DNS addresses, pins the checked address to a direct TLS connection with the registered hostname, rejects redirect responses, caps decoded bodies at 1 MB and applies an 8-second request deadline within a 40-second collection deadline. Native collection sends no application credentials, invokes no model and uses no reader service. An HTTP 429 yields an error without a retry in the current collection. HN and GitHub isolate individual item/repository failures and retain partial evidence. The adapters preserve API caps; unknown dates, duplicates, detected instruction text and rejected future dates prevent completeness. Source text remains untrusted after sanitization.

HTML publishers that block static fetching or require scripts remain unavailable with `reader-disabled`; the adapter does not purchase or activate another provider.

## Publisher HTML without a reader (20 October 2026)

`anthropic-news`, `meta-ai`, `nieman-lab` and `tubefilter` have no feed. Quorum's HTML adapter only reads `article a[href]`, so the bridge returns `reader-disabled` for Meta and Tubefilter and undated or empty results for the other two. The native adapter (`free-feeds/sources/adapters/html.ts`) now reads the listing page itself:

- Same request guards as every native fetch: HTTPS only, host allowlist = the source host, public DNS pinned to the TLS connection, no redirects, 1 MB, 8 s.
- An item is a link on the publisher's own site (with or without `www.`), outside navigation paths (`/about`, `/careers`, `/press-kit`, `/tag/…`), with a title of at least eight characters from the link's own heading, text, `aria-label`, `title` or image `alt`, in that order of preference. A card is the widest ancestor that holds no other article link.
- Category and tag links (every label at most three words, never wrapping a heading) are not items and do not split cards. Anthropic's 20 October layout puts one beside every story.
- The date comes from `<time datetime>` or `<time>` text, then a dated permalink (`/2026/10/19/…`), then the text of a single leaf element (Meta writes `Jun 29, 2026` in a sibling `div`), then a month permalink (`/2026/10/…`). A day or month without a time of day becomes an upper bound and the item carries `dateEstimated: true` (see below).
- Up to eight in-window items with an estimated or missing date are re-read from their own article page (same host, 600 kB, 3.5 s shared budget, four at a time). `article:published_time`, `datePublished` in meta or JSON-LD, or `<time datetime>` replace the estimate only when they carry a real time of day. A date-only or midnight value in the meta tags or JSON-LD, or else a visible post date (`roscoe-post-date`, `entry-date`), is a day bound and replaces the listing's bound only when it is tighter. The same page's `og:image` becomes the item's `imageUrl` when the card had none. A failure leaves the listing values; nothing retries.
- If the runner's 8-second source deadline fires during that enrichment, the listing already parsed is kept and the result is partial with `collection-timeout`, so the source cursor stays where it was.
- No item text from a page other than its own card is used. Off-site links (`support.claude.com`) are never items.

No source needs a bridge exception. Tubefilter sits behind a Sucuri challenge that sometimes answers non-browser clients with a 307 "You are being redirected" page; when it does, the native result is `reader-disabled` for that run. The bridge cannot do better there: its adapter finds no `<article>` elements on Tubefilter even when the page is served.

## Estimated dates, cursor and limits (#112)

`dateEstimated: true` means `publishedAt` is an upper bound, never the publisher's own timestamp:

- a stated day without a time becomes the last instant that day still holds anywhere (next day 11:59:59 UTC), and a month permalink the last instant of that month, both clamped to the fetch time;
- a timestamp written at exactly midnight is a stated day too, in every native adapter: ISO 8601 in any offset (`2026-10-18T00:00:00.000Z`, `…T00:00:00+02:00`) and RFC 822 (`Sun, 18 Oct 2026 00:00:00 GMT` or `-0400`). anthropic.com writes its day-only dates this way in `article:published_time` and JSON-LD, and Hugging Face and OpenAI do in RSS. Read as an exact time, midnight is the start of the day, earlier than the post: a post that appeared after a 22:00 Prague run was dated before the next run's window and dropped for good while the source reported `ok`. A post really published at 00:00:00 UTC is now an estimate as well, which costs at most the 36-hour freshness error below. Numeric API timestamps (HN, Stack Exchange) stay exact. The bridge does not apply this rule: Quorum's collector filters midnight dates against the window before OwnDashboard sees them;
- an item with no date at all gets its `fetchedAt` (in `collectDneskaiFeed`, for both providers) instead of being held forever.

Freshness treats the estimate exactly like a real date: `pendingDneskaiCandidates` admits items up to 30 days old to Jev, and `marketing_dneskai_finish` selects news (`ai-news`, `tech-news`) up to 48 hours old, both on `publishedAt`. Because the bound is never earlier than the truth, an estimated item can look fresher than it is, by up to 36 hours for a stated day. A month permalink whose article page could not be read is much worse: its bound is the fetch time, so a post from early in the month can look up to a month fresher and pass the 48-hour news check (Nieman Lab is the only source with month-only permalinks; enrichment normally tightens its newest eight entries to a day). An undated item is fresh only in the run that first stores it: the same canonical URL is never inserted again, so later runs cannot refresh it. Article-page enrichment replaces most estimates on the newest entries. The Sources tab labels an estimate "estimated, latest possible".

A read that stopped only at its cap reports `collection-source-item-cap`: a full page, every item dated (an estimate counts), no other provider code than `item-cap`/`upstream-cap`, and at least one item in the window. The database then moves the source cursor to the newest accepted item, so the next run starts there. Items the cap cut off below that point are not fetched later; for RSS they usually leave the feed anyway. Any other partial result, an error or invalid URLs leave the cursor where it was. Feeds take 20 items per run and Instagram profiles 10; `free-feeds/registry.json` carries 20 so the native binding check accepts the new cap, while Quorum's own `config/sources.json` keeps 10 for its pipelines. Through the bridge, API sources (arXiv, HN, Bluesky, Spaceflight, Stack Exchange) therefore still return at most 10.

Known gaps in the cursor rule:

- A read that dropped an item for prompt-injection text (`untrusted-instructions`) is partial whether it was capped or not, so it never advances. In the 20-item native run that was `the-register` (`item-cap,untrusted-instructions`), `hn-frontpage` (`untrusted-instructions,upstream-cap`, 19 items) and `simonw` (`untrusted-instructions`, 12 items). Those sources keep reading from their last successful cursor (7 days back when they never had one) and the Sources tab shows the `collection-cursor-recovery-required` note until a run ends without the extra code. This is deliberately conservative; deduplication by canonical URL keeps the re-reads from creating candidates twice. The same holds for `collection-timeout` and any other code.
- Some publishers truncate their feed below the cap (`the-verge`, `mit-tech-review`, `variety` and `wired-ai` serve 10 items). At 20 items such a read is `ok` and the cursor moves to the run start, so "Complete" in the Sources tab means "everything the feed exposed", not "every post in the window". The feed exposes nothing older, so no extra item is lost compared with the 10-item cap, which reported `item-cap`.

## Image references

`dneskai-feed/1` items may carry `imageUrl` and `dateEstimated`. Both are optional, so a bridge response without them still parses. `imageUrl` is an image the adapter saw without an extra request: RSS `enclosure` (image types), `media:content`, `media:thumbnail`, the card image of an HTML listing, or the `og:image` of an article page the adapter already read for its date. It must be public HTTPS and at most 2,048 characters. The collection keeps it as the candidate's `mediaUrls`; nothing downloads it. Downloading and storing media is #114.

Deployment cutover is authorized (#110, decision 3); the 32-feed comparison below is its evidence. Keep Quorum schedules and bridge credentials until the owner chooses a cutover and rollback window. This implementation does not migrate approved articles, the editorial model engine, transcript processing, image generation or publication. The existing signed approved-article source integration remains available.

Offline validation uses publisher fixtures and injected public-address resolution. It proves registry identity parity, RSS filtering, caps, partial evidence, prompt-like source rejection, private DNS refusal, redirect refusal, body limits, cancellation and rate handling. Live availability from Vercel, the native provider in production and publication remain unverified.

## Web article and social topics are separate outputs

Superseded on 20 October 2026: the owner paused DNESKAi web articles and kept socials (#110, decision 1). The paragraph below records the 14 October position.

Owner clarification on 14 October 2026: DNESKAi web has one daily article,
while socials will cover more topics. The native provider selects only
`collectDneskaiFeed`; it does not select `refreshMarketingSources` or the
approved-article export. The BoardlessAI editorial process, web delivery and
their existing triggers remain unchanged. Do not retire shared Quorum cycles
that still produce or deliver the web article when cutting over social feeds.
The daily web article remains subject to its existing quality/review gates;
a social topic cannot cause a second web article or approve an edition.

Native results are research candidates, not approved article SourcePackets.
The existing content adapter still requires a final BoardlessAI article.
Independent social briefs from other selected topics are a remaining step
in #96/#104; never relabel research as a published or approved web article.

## Live read-only comparison, 14 October 2026

The local native provider and the existing production signed bridge both
returned ten OpenAI feed items for the same seven-day window. Their ordered
external-ID/URL hashes matched exactly; both returned partial capture.
No Apify/Jev/Claude call, DB write, schedule activation or web delivery
operation occurred. Private proofs retain counts, hashes and statuses only.
The first bridge comparison attempt did not complete because the diagnostic
request omitted bearer authentication and used the wrong timestamp unit;
the corrected request used the existing signing helper and returned HTTP 200.
This is one-source evidence, not certification of all 32 publishers.

## Live read-only comparison, 20 October 2026 (32 feeds)

The production bridge secret is not available to an agent, so the two code paths were called directly with identical inputs. Bridge = Quorum's own `collectMarketingSources` (`orchestrator/src/marketing-source/collection.ts`, quorum `9a9850f`) with `config/sources.json` and `config/network-allowlist.json`, exactly what `/admin/api/marketing-collection` runs. Native = `collectNativeDneskaiFeed` through `scripts/dneskai-native-feeds.ts`. Each source was requested alone, as the runner does, with the first-run window (`since` = now − 7 days, no stored cursor) and the registry's `maxItems` (10). `scripts/dneskai-feed-compare.ts` compares the outputs. No database row, credential, model, reader or paid API was used; no schedule or deployment changed.

The sandbox has two egress routes and publishers treat them differently, so every path ran on both, each pair within ten seconds (17:09:27–17:09:47 UTC; windows from 17:09:26 and 17:09:34 UTC on 13 October):

- **direct**: the native pinned TLS transport as it runs in production, and Node's `fetch` for the bridge. Ars Technica, The Verge, Wired, Stack Exchange and GitHub answer this sandbox address with HTTP 403 for any client.
- **proxy**: both paths through the sandbox's HTTPS proxy (`NODE_USE_ENV_PROXY=1`; the native script swaps in `fetch` with `--egress proxy`, DNS checks unchanged). Nieman Lab's Cloudflare blocks this address.

Neither route is Vercel's, so availability in production is still to be confirmed by the first manual run. Parsing, filtering and identity are what this comparison establishes.

| Source | Kind | Bridge, direct | Native, direct | Bridge, proxy | Native, proxy | Shared URLs / same id / same date (proxy) | Native exact / estimated dates, imageUrl (best run) |
|---|---|---|---|---|---|---|---|
| `404-media` | rss | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | 10 / 10 / 10 | 10 / 0, 10 |
| `anthropic-news` | html | ok · 0 | ok · 4 | ok · 0 | ok · 4 | 0 / 0 / 0 | 4 / 0, 4 |
| `ars-technica` | rss | error `fetch-failed` · 0 | error `fetch-failed` · 0 | partial `item-cap` · 10 | partial `item-cap` · 10 | 10 / 10 / 10 | 10 / 0, 10 |
| `arxiv-cs-ai` | arxiv | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | 10 / 10 / 10 | 10 / 0, 0 |
| `arxiv-cs-lg` | arxiv | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | 10 / 10 / 10 | 10 / 0, 0 |
| `bluesky-language-models` | bluesky | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | 10 / 10 / 10 | 10 / 0, 0 |
| `deepmind-blog` | rss | ok · 3 | ok · 3 | ok · 3 | ok · 3 | 3 / 3 / 3 | 3 / 0, 2 |
| `digiday` | rss | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | 10 / 10 / 10 | 10 / 0, 0 |
| `github-ai-releases` | github | error `empty-source` · 0 | error `empty-source` · 0 | error `empty-source` · 0 | error `empty-source` · 0 | 0 / 0 / 0 | 0 / 0, 0 |
| `google-research` | rss | ok · 4 | ok · 4 | ok · 4 | ok · 4 | 4 / 4 / 4 | 4 / 0, 4 |
| `hf-blog` | rss | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | 10 / 10 / 10 | 10 / 0, 0 |
| `hn-frontpage` | hn | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | 9 / 9 / 9 | 10 / 0, 0 |
| `import-ai` | rss | ok · 1 | ok · 1 | ok · 1 | ok · 1 | 1 / 1 / 1 | 1 / 0, 0 |
| `interconnects` | rss | ok · 2 | ok · 2 | ok · 2 | ok · 2 | 2 / 2 / 2 | 2 / 0, 2 |
| `meta-ai` | html | error `reader-disabled` · 0 | ok · 0 | error `reader-disabled` · 0 | ok · 0 | 0 / 0 / 0 | 0 / 0, 0 |
| `mit-tech-review` | rss | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | 10 / 10 / 10 | 10 / 0, 0 |
| `nieman-lab` | html | partial `item-cap,unknown-date` · 10 | partial `item-cap` · 10 | error `reader-disabled` · 0 | error `reader-disabled` · 0 | 0 / 0 / 0 | 0 / 10, 9 |
| `openai-blog` | rss | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | 10 / 10 / 10 | 10 / 0, 0 |
| `platformer` | rss | ok · 2 | ok · 2 | ok · 2 | ok · 2 | 2 / 2 / 2 | 2 / 0, 2 |
| `rest-of-world` | rss | error `fetch-failed` · 0 | ok · 4 | error `fetch-failed` · 0 | ok · 4 | 0 / 0 / 0 | 4 / 0, 4 |
| `simonw` | rss | partial `item-cap` · 10 | partial `item-cap,untrusted-instructions` · 10 | partial `item-cap` · 10 | partial `item-cap,untrusted-instructions` · 10 | 9 / 9 / 9 | 10 / 0, 0 |
| `social-media-today` | rss | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | 10 / 10 / 10 | 10 / 0, 0 |
| `spaceflight-news` | spaceflight | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | partial `item-cap,upstream-cap` · 10 | 10 / 10 / 10 | 10 / 0, 0 |
| `stackexchange-ml` | stackexchange | error `fetch-failed` · 0 | error `fetch-failed` · 0 | error `unusable-source` · 0 | error `fetch-failed` · 0 | 0 / 0 / 0 | 0 / 0, 0 |
| `stratechery` | rss | ok · 5 | ok · 5 | ok · 5 | ok · 5 | 5 / 5 / 5 | 5 / 0, 0 |
| `techcrunch-ai` | rss | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | 10 / 10 / 10 | 10 / 0, 0 |
| `tensorfeed` | rss | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | 0 / 0 / 0 | 10 / 0, 0 |
| `the-register` | rss | partial `item-cap` · 10 | partial `item-cap,untrusted-instructions` · 10 | partial `item-cap` · 10 | partial `item-cap,untrusted-instructions` · 10 | 10 / 10 / 10 | 10 / 0, 10 |
| `the-verge` | rss | error `fetch-failed` · 0 | error `fetch-failed` · 0 | partial `item-cap` · 10 | partial `item-cap` · 10 | 10 / 10 / 10 | 10 / 0, 0 |
| `tubefilter` | html | error `reader-disabled` · 0 | partial `item-cap` · 10 | error `reader-disabled` · 0 | partial `item-cap` · 10 | 0 / 0 / 0 | 7 / 3, 7 |
| `variety` | rss | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | partial `item-cap` · 10 | 10 / 10 / 10 | 10 / 0, 10 |
| `wired-ai` | rss | error `fetch-failed` · 0 | error `fetch-failed` · 0 | partial `item-cap` · 10 | partial `item-cap` · 10 | 10 / 10 / 10 | 10 / 0, 10 |

Cells read status, `errorCode` and item count. "Shared URLs / same id / same date" compares the proxy pair item by item.

Per-source reading:

- **Same URLs, external ids and dates on the proxy route (22 feeds)**: every reachable RSS, arXiv, Bluesky and Spaceflight source except two. `hn-frontpage` differs by one story because the top-stories list changed between the two calls. `tensorfeed` (an aggregator) returned different items to back-to-back requests in the proxy run and identical ones in the direct run.
- **`simonw`, `the-register`**: native additionally reports `untrusted-instructions` because it drops an item whose text matches the prompt-injection patterns and takes the next one. Intended.
- **`rest-of-world`**: the feed is not well-formed XML (bare `&` in media URLs). Both parsers failed before; native now retries once with only those ampersands escaped and returns the 4 in-window items with images. The bridge still fails.
- **`anthropic-news`**: native returns the 4 in-window posts with their article pages' `og:image`. The dates in this table were recorded before the midnight rule: the article pages give only a day, written as `T00:00:00.000Z`, and the table counts them as exact. Native now reports them as day bounds with `dateEstimated` (see "After the midnight rule" below). The bridge returned 0 on the current layout, and 10 undated items (two of them the support page and the press kit) on the layout served 15 minutes earlier.
- **`meta-ai`**: native `ok` with 0 items: the five posts on the listing are dated 29 June–27 July 2026, outside the window. The bridge cannot read the page (`reader-disabled`).
- **`nieman-lab`**: reachable only on the direct route. Native returns 10 items with images; the bridge returns 9 of the same URLs undated. Nieman's permalinks carry only the month, so native dates are estimates: six were tightened to a day from the article's visible post date; the four newest stay at the month bound, which is the fetch time.
- **`tubefilter`**: native returns 10 items from dated permalinks (7 exact after article enrichment in the proxy run, 5 in the direct run); the bridge returns `reader-disabled`. Sucuri served its challenge page to two of seven native requests during the session.
- **`github-ai-releases`**: `empty-source` on both paths and both routes: the GitHub API answered 403 (unauthenticated rate limit for these addresses). The native adapter's projection is covered offline in `tests/lib/dneskai-native-feed.test.ts`; live availability is unverified.
- **`stackexchange-ml`**: 403 on the direct route; through the proxy native returned `ok` · 0 (a full page entirely older than the window) once and `fetch-failed` (API throttle) once. Live availability is unverified for production.
- **`ars-technica`, `the-verge`, `wired-ai`**: identical on the proxy route; the direct route is blocked for both paths.

### After the midnight rule (19:16 UTC)

The comparison table above is the 17:09 UTC record. After the midnight rule landed, the native path was re-run read-only through the proxy route for the affected sources, at 20 items:

| Source | Status · items | Estimated dates | Midnight dates left |
|---|---|---|---|
| `anthropic-news` | ok · 4 | 4 (the article pages give only a day) | 0 |
| `hf-blog` | ok · 12 | 7 | 0 |
| `openai-blog` | ok · 14 | 5 | 0 |
| `tubefilter` | ok · 12 | 4 | 0 |
| `meta-ai` | ok · 0 | 0 | 0 |
| `nieman-lab` | error `reader-disabled` (Cloudflare blocks the proxy route) | | |

With the window a run gets after the 22:00 Prague collection of 18 October (`since` = 18 October 19:55 UTC), the same sources return Anthropic's `public-benefit-fund` post (dated 18 October, bound 19 October 11:59:59 UTC), which the previous code dropped while reporting `ok`, and 4 of 7 Hugging Face and 1 of 3 OpenAI items as day bounds. For `hf-blog` and `openai-blog` the native dates now differ from the bridge's on exactly those items; URLs and external ids are unchanged.

Result: on the route that reached each publisher, native matches the bridge item for item or returns strictly more usable items (Anthropic, Meta, Tubefilter, Rest of World). No source needs to stay on the bridge. Two sources (GitHub, Stack Exchange) could not be reached from this sandbox by either path and need the first production run as evidence.

Cutover (owner/integrator): set `MARKETING_DNESKAI_FEED_PROVIDER=native` in production, run one manual collection (`MARKETING_DNESKAI_MANUAL_RUN`), and check the Sources tab. The code default stays `bridge`; unsetting the variable or setting `bridge` is the rollback. Turn off Quorum's `DNESKAI_COLLECTION_ENABLED` only after that run.

