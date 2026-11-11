# Apify research proposal, 11 November 2026

This is the review copy for the two Strategy backlog items. The proposal leaves the existing runner, hashes, ledger and reservations in place. The owner approves a new exact input list and cost ceiling before any paid run.

## Evidence and limits

Apify Billing showed $114.17 prepaid remaining and $59.83 consumed. The current period ends 14 November UTC, the invoice date is 15 November and the $100 and $50 offers expire 22 November. Recheck the balance after billing. End this proposal's runs by 21 November UTC. [Apify billing documentation](https://docs.apify.com/platform/console/billing).

The total proposed ceiling is $60 across both brands, with at most $2 per run. Allocate at most $10 to qualification, $25 to the first study, $15 to selected repeat observations and $10 to reserve. Before running, record the actor's applicable event and platform usage charges and check that the complete run can stay within its ceiling. Use `maxTotalChargeUsd: 2` for supported pay-per-event actors, `timeout: 120` and the smaller input limits below. Hold the run if the actor, plan or proxy adds any cost that the proposed ceiling cannot bound. A failed run consumes its recorded charge. [Apify Run Actor reference](https://docs.apify.com/api/v2/actors-runs-post).

## Use the existing datasets

- devShark. In the 241-row export, 239 rows matched the requested accounts and 26 matched the original 45-day window. Start with `peterpandev`, `codewithjamal` and `typescriptheo`, whose feeds yielded recent English development content. Recheck the five other accounts before using them. [Existing devShark run](https://console.apify.com/actors/shu8hvrXbJbY3Eb9W/runs/pNQxeXiely2kpyt0h).
- DNESKAi. Checked all 325 rows in the existing mixed run. For the 28 September–11 November window, `chytre_podnikani` had 10 recent rows and `ai_tipy` had nine. Review the first account's mix of education and promotion before inclusion. `aifirstcz` appeared with one recent educational row as a coauthor and needs a direct profile check. `thomas_umela_inteligence` and `ainovinky` supplied older posts. General news and foreign-language accounts belong outside the Czech learning comparison. [Existing mixed run](https://console.apify.com/actors/shu8hvrXbJbY3Eb9W/runs/oDvW9XZKlre94VrsU).
- The 2,806-row run's input was predominantly lifestyle and virtual-influencer profiles. Exclude it alongside the existing 718- and 2,367-row lifestyle runs. [Existing lifestyle run](https://console.apify.com/actors/shu8hvrXbJbY3Eb9W/runs/nq3TRYxyW40xUnMgN).

## Pinned actor candidates and payloads

Public actor metadata was read on 11 November. Recheck the exact pinned build and event prices in the signed-in Console before approval. The public storefront displayed starting prices of $1.50/1,000 Instagram scraper results, $1.60/1,000 profiles and $2.50/1,000 Threads results. Those prices vary with the plan and billable event.

| Stage | Actor ID and build | Inputs |
| --- | --- | --- |
| Profile qualification | `dSCLg0C3YEZ83HzYX` · `0.0.680` · `O3xai7MXpAlc3Owt8` | `usernames` receives a reviewed list of at most 20 per brand, `includeAboutSection: false`. For the first inspection use the three existing devShark candidates and the two Czech direct-profile candidates listed above. |
| Instagram posts | `shu8hvrXbJbY3Eb9W` · `0.0.854` · `74Kf0ViHaUgffCkuD` | `directUrls` receives the 8–12 qualified profile URLs, `resultsType: "posts"`, `resultsLimit: 30`, `onlyPostsNewerThan: "2026-09-28T00:00:00Z"`, `addParentData: true`. |
| Threads posts | `lct1dlYksEDIG9If9` · `0.0.450` · `V3eYgiborAgoRZsrI` | `mode: "user"`, `usernames` receives at most six verified handles per brand, `max_posts: 30`. Apply the date window to the returned timestamps because the actor ignores date fields in this mode. |
| Audience questions | `499mNnuVGkU2S5rh1` · `0.0.168` · `UeigLBIAcxFi23Rgc` | `postUrls` receives exactly 12 or fewer reviewed education posts across both brands, `maxCommentsPerPost: 10`, `sortOrder: "recent"`. Retain only anonymized themes. |
| Trends | `DyNQEYDj9awfGQf9A` · `0.0.148` · `Od1fMMVq5uvBLyLSI` | One existing Google Trends Explore URL per brand in `startUrls: [{url}]`, `maxItems: 1`, `maxConcurrency: 1`, `maxRequestRetries: 0`. Use a fixed date range of 28 September to 11 November. Czech group: AI v práci, ChatGPT, automatizace. Worldwide group: JavaScript, CSS Grid, TypeScript. |
| Transcripts, optional | `5NPYjuQRaRckuFXRI` · `1.0.221` · `5FwNOvUqsy38LWAVF` | At most 12 selected public teaching Reel URLs across both brands. Hold until the selection, input schema and charges including duration surcharge are reviewed. |

[Instagram post input](https://apify.com/apify/instagram-scraper/input-schema) · [Profile input](https://apify.com/apify/instagram-profile-scraper/input-schema) · [Threads input](https://apify.com/futurizerush/meta-threads-scraper/input-schema) · [Comment input](https://apify.com/scrapesmith/instagram-comments-scraper/input-schema) · [Trends input](https://apify.com/apify/google-trends-scraper/input-schema) · [Transcript input](https://apify.com/steadyfetch/instagram-reel-transcript-scraper/input-schema).

Use UTC timestamps from 28 September 00:00 inclusive to 12 November 00:00 exclusive for this fixed 45-day sample. Filter pinned posts, replies and duplicates before comparison. Keep at most 30 qualifying posts per profile. Compare the same platform, format and time since publication. Keep hidden counts empty and use native Insights for reach and saves. Revisit only selected URLs for the three- and seven-day checks.

Stop before collecting posts if fewer than eight profiles in a brand meet the language, audience, activity and teaching criteria. Stop on an unrecognized build, a changed cost basis, loss of the cap, expired approval or a sample dominated by irrelevant rows. Record the final handles and post URLs and hash the reviewed payload before approval. The exact post, question and transcript lists depend on cohort qualification.
