# DNESKAi native free-feed migration

OwnDashboard can collect the existing 32 free feeds without calling Quorum. Select `MARKETING_DNESKAI_FEED_PROVIDER=native` in a reviewed deployment to use the local adapters. Unset or `bridge` keeps the existing signed collection bridge. An unknown value fails closed. This change sets no deployment variables. Verification includes one public OpenAI feed comparison, described below.

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

Deployment cutover still needs owner authorization and a live comparison of source availability, cap/partial evidence and duplicate IDs against the bridge. Keep Quorum schedules and bridge credentials until the owner chooses a cutover and rollback window. This implementation does not migrate approved articles, the editorial model engine, transcript processing, image generation or publication. The existing signed approved-article source integration remains available.

Offline validation uses publisher fixtures and injected public-address resolution. It proves registry identity parity, RSS filtering, caps, partial evidence, prompt-like source rejection, private DNS refusal, redirect refusal, body limits, cancellation and rate handling. Availability of the other 31 feeds, cloud native-provider deployment and publication remain unverified.

## Web article and social topics are separate outputs

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
