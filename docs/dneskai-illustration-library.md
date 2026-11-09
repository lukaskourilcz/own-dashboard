# DNESKAi illustration library: sources

Research of 9 November 2026 (owner request: every DNESKAi slide carries a photograph, so posts need a library of
illustration photos that may be downloaded, stored and reused commercially). The rule that decides the shortlist is
DNESKAi's own: **no slide and no caption carries a picture credit** (owner rule, 22 October 2026). A source whose licence
requires attribution can therefore not feed the library, however good its pictures.

| Source | Licence for stored, commercial reuse | Attribution | API and limits | Fit for tech, AI, business, CZ news | Verdict |
|---|---|---|---|---|---|
| **Pexels** | Pexels licence: free for any use, including commercial; no selling unaltered copies, no implied endorsement by people shown | Not required (a link to Pexels near the API use is asked for, which the Lab already shows) | `PEXELS_API_KEY` is set in production. 200 requests an hour, 20,000 a month; responses may be cached 24 hours | Strong on offices, devices, data centres, city, people at work; weak on named Czech places | **Use**: the library's main source |
| **Pixabay** | Pixabay content licence: free for commercial use, no attribution | Not required | API key needed (none in OwnDashboard; Quorum has one). 100 requests a minute; results cached 24 hours | Similar to Pexels plus illustrations and vectors | **Use later**: needs `PIXABAY_API_KEY` in OwnDashboard (backlog) |
| **Unsplash API** | Unsplash licence is free for commercial use | **Required** in API apps, and the API requires hotlinking its URLs instead of storing files | 50 requests an hour in demo, 5,000 after production review | Excellent quality | **No**: hotlinking and credit both break DNESKAi's rules |
| **Openverse** | Mixed Creative Commons; filter `license_type=commercial` | CC BY and CC BY-SA require credit; only CC0 and Public Domain Mark do not | Anonymous access is throttled (a token raises it); scraping the catalogue is forbidden by its terms | Broad but uneven | **Only CC0/PDM**, and only for gaps |
| **Wikimedia Commons** | Mostly CC BY-SA | Required for most files | MediaWiki API, generous | Good for named places, buildings, people | **Only public-domain files**, for named Czech places |
| **NASA / ESA** | NASA imagery is generally public domain; ESA is CC BY-SA IGO | NASA: none required (no endorsement); ESA: required | NASA Image API, no key | Space only | **NASA for space**; not ESA |
| **Burst (Shopify), StockSnap, Kaboompics** | CC0-like licences | Not required | No public API (site downloads only) | Lifestyle and e-commerce, little tech | **No**: no API to ingest from |
| **EU / Czech open data** | Varies by publisher (often CC BY 4.0) | Usually required | Per publisher | Policy and statistics, rarely photographs | **No** for photographs |

## What the library does

- **Ingest** (`dneskai_illustrations`, private bucket `dneskai-illustrations`): Pexels search per topic of the DNESKAi
  set (AI, chips, phones, banking and fintech, startups, Prague and Czechia, offices, data centres, people at work,
  crypto, energy, cars and EVs, space, health, education, policy). Each picture is stored once with its source id,
  page URL, photographer and licence, and Claude vision writes its tags and flags anything that must not appear in a
  DNESKAi post (readable brand names, logos, a recognisable person's face as the subject, text). Flagged pictures are
  kept out of selection. A daily cost cap stops the paid look.
- **Selection** takes the least-used ready picture whose tags match the post's topic. A picture may serve several
  posts, but every reuse is drawn differently (another focal point and a 1.2 to 1.6 zoom) so it is not recognisable.
  Codex illustrations are stored at 1080 × 1350 and use the full frame on reuse. Their generated provenance is retained in the library and the brief.
- **Relevance**: pictures added to a post from stock or from the library are checked against the post's headline; an
  off-topic picture or one showing a competitor's brand (the Fio post that got a Swedbank tower) is refused.

## Sources

- Pexels API documentation and licence: <https://www.pexels.com/api/documentation/>, <https://www.pexels.com/license/>
- Unsplash API documentation (demo and production limits, hotlinking, attribution): <https://unsplash.com/documentation>
- Openverse API, authentication and throttling: <https://api.openverse.org>, <https://wordpress.github.io/openverse-api/reference/api/authentication_and_throttling.html>
- Pixabay API: <https://pixabay.com/api/docs/>
- NASA Image and Video Library API: <https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf>
