# DNESKAi carousel reference board

Workstream E (research), 22 October 2026. 37 annotated examples. Patterns only: every example is linked and described in my own words. No caption is reproduced, no image was downloaded or viewed, nothing behind a login was opened, no Apify actor was run.

## How the evidence was gathered

- **Instagram's public embed pages.** `instagram.com/p/<code>/embed/captioned/` and `instagram.com/<handle>/embed/` serve without a login. They expose the account's follower count on the day of the fetch, the post type (carousel, video, image), the number of carousel items and how many of them are video, the pixel size of the first item, public like and comment counts (when not hidden), the caption, and whether alt text was set. I fetched 61 post embeds and 28 profile embeds on 2026-10-22, about 2 seconds apart. Caption numbers below (characters, paragraphs, hashtags, question and exclamation marks, emoji, credit lines) were counted by a script; I read caption openings only to classify the hook family.
- **Posting time.** The embed shows no date. Instagram media ids carry a millisecond timestamp, so the time below is derived from the shortcode (id shifted right by 23 bits plus Instagram's epoch, 1314220021721 ms). I checked the method against two posts whose times the pipeline already stores in production (`DeSfnkwkunF` 23:39 and `DeM28vEmoSp` 19:07 Prague): both match to the minute. Times are given in Prague time.
- **What the embed cannot show.** Slide images were not viewed, so cover text, type scale, grid and margins, colour, photo treatment, data or quote cards and the swipe device are **not observed** unless a public write-up or the owner's screenshots describe them. Where they do, the entry says which source and marks it secondary. The slide-1 hook is classified from the caption's first line and flagged "caption-derived": a cover can differ from its caption.
- **Engagement snapshots.** Many posts were 1 to 30 hours old at fetch time, so like and comment counts are early snapshots and not comparable across posts. Saves and sends are never public.
- **Status labels.** **Verified**: every fact in the entry comes from a public page I opened in this session. **Mixed**: the post facts are verified; the design description is secondary (named source). **Secondary**: reported by a source I did not re-open, or by the owner's screenshots.

Field shorthand used in each entry: slides (video items), ratio (height:width of item 1), caption (characters / paragraphs), hashtags, `?` and `!` counts, emoji count, credit line in caption, link-in-bio line, posting time (Prague), public likes / comments at fetch.

## Summary table

| # | Account | Post | Slides (video) | Ratio | Caption chars / paras | Hashtags | Credit line | Posted (Prague) | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | @evolving.ai | DewxpImgHJr | 10 (1) | 4:5 | 1,097 / 6 | 0 | no | Wed 21 Oct 17:53 | Verified |
| 2 | @evolving.ai | DewgpqwgHnJ | 6 (6) | 4:5 | 835 / 9 | 1 | no | Wed 21 Oct 15:25 | Verified |
| 3 | @technology | DexWToBiVQ_ | 5 (1) | 4:5 | 644 / 5 | 3 | no | Wed 21 Oct 23:14 | Verified |
| 4 | @therundownai | DexLhS_EvwO | 4 (0) | 4:5 | 681 / 6 | 0 | Source | Wed 21 Oct 21:39 | Verified |
| 5 | @therundownai | DexQftDks1b | 2 (1) | 4:5 | 764 / 8 | 0 | Source | Wed 21 Oct 22:23 | Verified |
| 6 | @tldr_newsletter | DexaSRplFqJ, DewgQs2kQgN | 4, 4 | 4:5 | 873 / 4, 849 / 4 | 0 | Sources + Images | Wed 21 Oct 23:48, 15:21 | Verified |
| 7 | @heyzainkahn (Superhuman) | DJPW-eXA4f6 | 5 (0) | 4:5 | 156 / 2 | 0 | no | Sun 4 May 2025 19:26 | Verified |
| 8 | @mosseri | DeSfnkwkunF | 6 (0) | 3:4 | 1,820 / 13 | 0 | no | Fri 9 Oct 23:39 | Verified |
| 9 | @metaglasses | DeM28vEmoSp | 8 (7) | 4:5 | 85 / 2 | 0 | no | Wed 7 Oct 19:07 | Verified |
| 10 | @nytimes | DexNYwrgTVr | 3 (0) | 4:5 | 675 / 3 | 0 | Graphics by | Wed 21 Oct 21:56 | Verified |
| 11 | @thedailyaus | Dev3eDdG9ds, DevuZADGxj7 | 5 (2), 3 (1) | 4:5 | 153 / 2, 268 / 2 | 0, 1 | Reporting by | Wed 21 Oct 09:25, 08:06 | Verified |
| 12 | @impact | Dew8_jfmFG8 | 12 (2) | 3:4 | 794 / 6 | 1 | Design by | Wed 21 Oct 19:33 | Mixed |
| 13 | @impact | DexCrIYj3pv | 4 (0) | 3:4 | 619 / 6 | 0 | Design by | Wed 21 Oct 20:22 | Mixed |
| 14 | @ourworldindata | DeOSPGrgscr, DeqovkVAkhs | 5, 5 | 4:5, 3:4 | 161 / 2, 142 / 2 | 0 | no | Thu 8 Oct 08:25, Mon 19 Oct 08:40 | Mixed |
| 15 | @guardianaustralia (via @guardian) | DeviSMJCETk | 8 (0) | 4:5 | 234 / 2 | 0 | no | Wed 21 Oct 06:20 | Verified |
| 16 | @politicsjoe | DewS9ZwjNYl | 2 (0) | 4:5 | 17 / 1 | 0 | no | Wed 21 Oct 13:25 | Mixed |
| 17 | @bbcnews | profile snapshot | 6 of 6 latest are video | - | - | - | - | 21-22 Oct | Mixed |
| 18 | @theeconomist | profile snapshot | latest mostly single images | - | - | - | - | 21-22 Oct | Mixed |
| 19 | @reuters | profile snapshot | 6 of 6 latest are video | - | - | - | - | 21-22 Oct | Mixed |
| 20 | @jsemvobraze | Depd3qDgqR0 | 9 (0) | 4:5 | 36 / 1 | 0 | no | Sun 18 Oct 21:46 | Mixed |
| 21 | @jsemvobraze | DerAvZwAicL | 16 (5) | 4:5 | 2,181 / 22 | 2 | no | Mon 19 Oct 12:10 | Verified |
| 22 | @jsemvobraze (2021-22) | CUC3lpfsnJw, CkbBcmWM8A5, ClDtOC4gkgD | 9, 7, 9 (1) | ~5:6, 1:1, ~5:6 | 873 / 4, 130 / 3, 2,128 / 12 | 8, 2, 0 | no | 2021-09-20, 2022-11-01, 2022-11-17 | Verified |
| 23 | @dokontextu | CS92TOgLC5F, CSr8SWSr7KL | 10, 9 | 1:1 | 828 / 7, 2,065 / 8 | 5, 5 | Grafika | Aug 2021 | Verified |
| 24 | @dokontextu | Cp0glTjLjl- | 10 (0) | 1:1 | 325 / 5 | 1 | Grafika | Wed 15 Mar 2023 19:57 | Verified |
| 25 | @refreshernews.cz | Dev9nPgimTz | 5 (0) | 4:5 | 468 / 3 | 0 | photo credit | Wed 21 Oct 10:19 | Verified |
| 26 | @refreshernews.cz | DewoKZ5CpIY | 4 (0) | 4:5 | 369 / 3 | 0 | photo credit | Wed 21 Oct 16:31 | Verified |
| 27 | @seznamzpravy | Dew5RcsCmW4, Dewyd0mCieq | 3, 3 | 4:5 | 291 / 5, 207 / 2 | 0 | photo credit (1st) | Wed 21 Oct 19:00, 18:01 | Verified |
| 28 | @czechcrunch | DexCowMAFoM | 6 (0) | 4:5 | 212 / 3 | 1 | no | Wed 21 Oct 20:22 | Verified |
| 29 | @cervenapropiska | DeEsyDgAB-d | 4 (0) | 4:5 | 27 / 1 | 0 | no | Sun 4 Oct 15:04 | Mixed |
| 30 | @petrmara | Deb5HzmAlyk | 4 (1) | 3:4 | 22 / 2 | 0 | no | Tue 13 Oct 15:15 | Verified |
| 31 | @hundredth | Ce4YxZwOv_1 | 10 (0) | 4:5 | 155 / 1 | 0 | photographers | Thu 16 Jun 2022 23:21 | Mixed |
| 32 | @markmanson | CfG8cekMD4- | 5 (0) | 4:5 | 77 / 1 | 0 | no | Wed 22 Jun 2022 15:02 | Mixed |
| 33 | @nathanwpylestrangeplanet | CeEbR-xLY_D | 2 (0) | 1:1 | 17 / 1 | 0 | no | Jun 2022 | Mixed |
| 34 | @metricool | CxGeHpoLBSd | 10 (0) | 4:5 | 623 / 6 | 10 | no | Tue 12 Sep 2023 20:02 | Verified |
| 35 | @beautymavenraven (Edits launch example) | DcbzoNfluXC | 6 (1) | 3:4 | 308 / 2 | 3 | no | Mon 24 Aug 21:24 | Mixed |
| 36 | Our World in Data, Data Insights (web) | data-insights page | n/a | n/a | ~180 words | n/a | Data source + licence | 2026-09-26 | Verified |
| 37 | Growth.design case study (web) | onboarding case study | 10 frames | n/a | n/a | n/a | n/a | 2019-07-03 | Verified |

Count: 23 Verified, 14 Mixed, 0 purely Secondary. Every Mixed entry's post facts were opened in this session; only its design description is secondary.

## A. AI and tech news accounts

### 1. @evolving.ai, 10-slide security story (Verified)
https://www.instagram.com/p/DewxpImgHJr/ · 4.87M followers · 10 items (1 video) · 4:5 · caption 1,097 chars in 6 paragraphs · 0 hashtags · 0 `?` 0 `!` · 2 emoji (both on the first line) · no credit line · Wed 21 Oct 17:53 · 8,068 likes / 95 comments at fetch.
- Hook (caption-derived): an emoji alarm marker plus a scale claim ("one of the biggest threats in years") tying a software flaw to AI. Scale-and-stakes family.
- Structure: the caption is a complete news story (what, how widespread, who reacted, what comes next) with no link, no CTA and no hashtags. Ten items is the long end for a news carousel.
- Visual fields: not observed.
- Lesson: the largest AI-news account in the registry tells the whole story in the post and keeps the caption hashtag-free and CTA-free; its hype markers (siren emoji, superlatives) are what DNESKAi's truth rules would cut.

### 2. @evolving.ai, all-video paid partnership (Verified)
https://www.instagram.com/p/DewgpqwgHnJ/ · 6 items, all video · 4:5 · 835 chars / 9 paragraphs · 1 hashtag (a partner disclosure tag) · 5 @mentions · Wed 21 Oct 15:25 · 5,821 / 218.
- Hook: a "what AI now makes possible" claim with money emoji. Value-plus-novelty family.
- Note: the profile embed shows the account's last ~20 grid items mix single images, reels and carousels; carousels are a minority. Paid partnerships appear inside the news stream, marked by a partner hashtag.
- Lesson: an all-video carousel is a reels-like format inside a carousel; it cannot take Instagram's library music (Help Center: no music on carousels with video).

### 3. @technology, founder-story carousel (Verified)
https://www.instagram.com/p/DexWToBiVQ_/ · 9.33M followers · 5 items (1 video) · 4:5 · 644 / 5 · 3 generic hashtags · like count hidden (shows 0) · Wed 21 Oct 23:14. A second post, https://www.instagram.com/p/DexhqWzjbde/ (3 items, Thu 00:53), is a sponsored AI-video tool announcement with a partner tag.
- Hook: a company "changing the way people do X" line. Story/social-proof family.
- Lesson: the biggest tech aggregator posts after midnight Prague (US evening), hides likes, and mixes sponsored product news into the feed. Volume model; low fit for DNESKAi.

### 4. @therundownai, study-finding carousel (Verified)
https://www.instagram.com/p/DexLhS_EvwO/ · 644K followers · 4 items · 4:5 · 681 / 6 · 0 hashtags · ends on a one-line "Source:" credit naming the study's publisher · Wed 21 Oct 21:39 · 75 / 4.
- Hook: the finding with its number up front (models matching an older flagship get much cheaper within months). Value/social-proof family with an attributed figure.
- Structure: finding, method in one sentence, two dated examples with numbers, source line. No CTA, no question.
- Lesson: the closest live analogue to DNESKAi's register in the registry: declarative, numeric, attributed, sourced in the caption. The number appears only because the source states it.

### 5. @therundownai, two-slide product news (Verified)
https://www.instagram.com/p/DexQftDks1b/ · 2 items (1 video) · 4:5 · 764 / 8 · 0 hashtags · "Source:" credit naming the vendor · Wed 21 Oct 22:23 · 306 / 3.
- Hook: company plus product plus what it does. Value family.
- Lesson: two slides are enough for a single product announcement when the caption carries the detail; the Rundown publishes several such posts a day (the profile embed shows 12 grid items within about 24 hours).

### 6. @tldr_newsletter, fixed-template news series (Verified)
https://www.instagram.com/p/DexaSRplFqJ/ and https://www.instagram.com/p/DewgQs2kQgN/ · 828K followers · 4 items each · 4:5 · ~850-870 chars in 4 paragraphs · 0 hashtags, 0 `?` 0 `!` 0 emoji · last line credits both text sources and image sources separately · link-in-bio line · Wed 21 Oct 23:48 and 15:21 · 147 / 0 and 175 / 9.
- Hook: the first paragraph is a dated news lead in wire style (who, what, when, severity). Value family.
- Series device: every caption closes with the same tagline pattern naming the topic as "explained in five minutes a day" plus a subscriber claim; every carousel has exactly four items (the profile embed shows four consecutive posts in the same 4-item shape).
- Lesson: the strongest model for DNESKAi's structure: fixed slide count, wire-style lead, no hashtags or emoji, and a credit line that separates text sources from image sources, which is exactly the split DNESKAi's sources slide makes. The newsletter CTA is the part the calm register would drop.

### 7. @heyzainkahn (Superhuman AI newsletter), tips carousel (Verified)
https://www.instagram.com/p/DJPW-eXA4f6/ · 74K followers · 5 items · 4:5 · 156 / 2 · 2 `!`, 2 emoji, newsletter CTA with link in bio · Sun 4 May 2025 19:26 · 395 / 5. The profile embed shows reels for every post since.
- Hook: "you're not doing X wrong, but you could do it better", addressed to the reader. Contrarian-lite, second person.
- Lesson: a creator-voice tips carousel with a sales CTA; the account has since moved to reels. Register and CTA do not fit DNESKAi.

### 8. @mosseri, personal book carousel (Verified)
https://www.instagram.com/p/DeSfnkwkunF/ · 4.22M followers · 6 items · **3:4** (3072 × 4096 first item) · 1,820 / 13 · 0 hashtags, 0 `?` 0 `!` 0 emoji · Fri 9 Oct 23:39 · 41,836 / 629.
- Hook: a plain statement plus a request for recommendations (no question mark). Personal/story family.
- Lesson: the head of Instagram posts his own carousel at 3:4, the ratio the app now accepts and the profile grid uses; the Graph API still caps at 4:5 (see playbook). Long, calm, unadorned captions are normal at the top of the platform.

### 9. @metaglasses, product-moment carousel (Verified)
https://www.instagram.com/p/DeM28vEmoSp/ · 406K followers · 8 items, 7 video · 4:5 · 85 chars in 2 lines · 0 hashtags · Wed 7 Oct 19:07 · 16,125 / 906.
- Hook: three short fragments listing what the product did, then a one-line series label. Value family, terse.
- Lesson: a very short caption is enough when the media carry the story; most items are video, so no library music.

## B. News and explainer brands

### 10. @nytimes, poll data carousel (Verified)
https://www.instagram.com/p/DexNYwrgTVr/ · 20.6M followers · 3 items · 4:5 · 675 / 3 · 0 hashtags, no emoji · last line credits the graphics designer by name and points to the link in bio · Wed 21 Oct 21:56 · 7,477 / 371.
- Hook: the headline finding of a poll, stated flatly with its percentage. Social-proof family (attributed number).
- Data card: the caption cites the poll's percentages; Nieman Lab (July 2021, via sweep-brands, secondary) describes NYT slides as templated, text-heavy cards that can carry maps and charts from the site.
- Lesson: three slides, one finding, a named graphics credit. Of the NYT's last 6 grid items, 1 is a carousel, 2 reels, the rest single images.

### 11. @thedailyaus, attributed-quote explainers (Verified)
https://www.instagram.com/p/Dev3eDdG9ds/ (5 items, 2 video, Wed 21 Oct 09:25, 7,939 / 94) and https://www.instagram.com/p/DevuZADGxj7/ (3 items, 1 video, 08:06) · 657K followers · 4:5 · 150-270 chars in 2 paragraphs · 0-1 hashtags · reporter credited by handle.
- Hook: an official's surprising admission, attributed by name and role ("a spokesperson told us it is possible that..."). Curiosity with attribution.
- Lesson: short caption, the slides carry the explainer, the reporter is credited. Brand-led, not personality-led, which is DNESKAi's situation. The Prague times above (08:06 and 09:25) are about 17:00-18:30 in Sydney, the home audience's early evening.

### 12. @impact, 12-slide human-interest story (Mixed)
https://www.instagram.com/p/Dew8_jfmFG8/ · 2.52M followers · 12 items (2 video) · **3:4** · 794 / 6 · 1 series hashtag · last line credits the slide designer by handle · Wed 21 Oct 19:33 · 30,988 / 264.
- Hook: a named person and what she built, in one sentence. Story family.
- Visual (secondary, Teen Vogue 2025-05-27 via sweep-brands): bright colour, sans-serif type, collaged photography with film grain, a cohesive identity across posts.
- Lesson: Impact has moved to 3:4 and credits a designer on every post; the series hashtag marks a recurring format.

### 13. @impact, news carousel with a quote (Mixed)
https://www.instagram.com/p/DexCrIYj3pv/ · 4 items · 3:4 · 619 / 6 · 0 hashtags · designer credit · Wed 21 Oct 20:22 · 14,985 / 16.
- Hook: who stands behind whom, then a short attributed quote and the consequence. Story plus quote card.
- Lesson: a quote is used only with the speaker named in the same paragraph, which matches DNESKAi's rule that quotes must be in the evidence and attributed.

### 14. @ourworldindata, finding-led article carousels (Mixed)
https://www.instagram.com/p/DeOSPGrgscr/ (4:5, Thu 8 Oct 08:25, 1,603 / 22) and https://www.instagram.com/p/DeqovkVAkhs/ (**3:4**, Mon 19 Oct 08:40, 867 / 6) · 204K followers · 5 items each · ~150 chars in 2 lines · 0 hashtags · link-in-bio line.
- Hook: names the author and the question the article answers. Value family.
- Card convention (verified on ourworldindata.org, entry dated 2026-09-26): the title states the finding, one chart, about 180 words, a fixed "data source plus licence" line, and alt text that itself states the finding of the chart.
- Lesson: the cleanest data-card grammar available, and finding-as-alt-text is a cheap accessibility win DNESKAi's alt texts can copy as a pattern. Five slides, early-morning UK posting.

### 15. @guardian / @guardianaustralia, quote-led op-ed carousel (Verified)
https://www.instagram.com/p/DeviSMJCETk/ · appears on @guardian's profile embed; owner field is @guardianaustralia (538K) · 8 items · 4:5 · 234 chars / 2 · 0 hashtags · Wed 21 Oct 06:20 · 9,873 / 0 (comments closed or none).
- Hook: a pull quote from the op-ed author, attributed in the next line. Quote card.
- Lesson: a collab between two brand accounts; opinion pieces travel as quote-led carousels. DNESKAi carries no opinion, but the "attributed quote on slide 1" grammar works for a statement by an official or a company.

### 16. @politicsjoe, two-slide news card (Mixed)
https://www.instagram.com/p/DewS9ZwjNYl/ · 578K followers · 2 items · 4:5 · 17-character caption · Wed 21 Oct 13:25 · 1,232 / 120.
- Visual (secondary, Mobile and Digital Journalism, 2025-03-31, re-read this session): the account's model news carousel is a strong photo with a short headline, then the primary statement on a flat brand-yellow card.
- Lesson: the minimal pattern for a one-fact item: picture plus headline, then the source's own words on a flat card. Its wry caption tone does not fit DNESKAi.

### 17. @bbcnews, format snapshot (Mixed)
https://www.instagram.com/bbcnews/ (profile embed): the 6 latest grid items on 22 Oct 2026 are all video. Secondary (Press Gazette 2022 and Mobile and Digital Journalism 2025, via sweep-brands and re-read): its growth formula was audience focus, regular posting, explainers and text on images.
- Lesson: the largest news account's current grid is video-first; its text-on-image explainer era is the reference for calm cards, not its present output.

### 18. @theeconomist, format snapshot (Mixed)
https://www.instagram.com/theeconomist/ (profile embed): of the 6 latest items, 5 are single images and 1 a video; no carousel. Secondary (INMA 2022, via sweep-brands): a template system keyed to content type (article, chart, podcast, film, photo, quote), built to read in a second or two.
- Lesson: a template per content type, not a carousel per day, is what makes the grid recognisable.

### 19. @reuters, format snapshot (Mixed)
https://www.instagram.com/reuters/ (profile embed): 6 of 6 latest items are video. Secondary (Nieman Lab 2025-09-18, via sweep-brands): Reuters says it is doubling down on carousels for stories video handles badly and wants a hook within about three seconds.
- Lesson: the stated strategy and the visible grid diverge at the moment of the fetch; only a longer sample (owner-approved Apify) can settle the real mix.

## C. Czech accounts

### 20. @jsemvobraze, "news you may have missed" roundup (Mixed; owner's style reference)
https://www.instagram.com/p/Depd3qDgqR0/ · 224K followers · 9 items · 4:5 · caption is one short series line with one emoji · 0 hashtags · Sun 18 Oct 21:46 · 5,626 / 35.
- Inner slides (secondary: the owner's 12 screenshots, summarised in sweep-jsemvobraze): cover is the author's photo with the series title on marker-highlight blocks; inner slides stand on different coloured paper textures (the colour change is the swipe device); white text, one highlight colour per slide on names and numbers; the series label top-left, source publishers top-right, signature bottom-right on every slide; taped source clippings; dense body of about 60-90 words per slide at large size.
- Hook: series identity plus the author's face; no news hook on the cover.
- Lesson: a fixed series name, fixed slide furniture and sources named on every slide make a dense deck readable. The face, emoji, handwriting and paper photography are outside DNESKAi's rules.

### 21. @jsemvobraze, 16-item personal roundup with a paid partner (Verified)
https://www.instagram.com/p/DerAvZwAicL/ · 16 items (5 video) · 4:5 · 2,181 / 22 · 2 hashtags · 3 `?`, 8 `!`, 20 emoji · Mon 19 Oct 12:10 · 1,607 / 17.
- Hook: a personal monthly "what moved me" line. Story family, first person.
- Lesson: the account uses the full slide budget for lifestyle content and partner thanks; its news roundups (entry 20) earn about 3.5 times the likes. The emotive register is the opposite of DNESKAi's.

### 22. @jsemvobraze, 2021-22 archive (Verified)
https://www.instagram.com/p/CUC3lpfsnJw/ (climate and elections, 9 items, ~5:6 portrait, 873 chars, 8 mixed Czech/English hashtags, 2021-09-20 15:17), https://www.instagram.com/p/CkbBcmWM8A5/ (7 items, 1:1, 130 chars, sarcastic question opener, 2022-11-01 15:47), https://www.instagram.com/p/ClDtOC4gkgD/ (9 items incl. 1 video, ~5:6, 2,128 chars in 12 paragraphs, diary of a reporting trip, 6 @mentions of the outlet she worked with, 2022-11-17 10:59, 12,386 / 79). Alt text empty on every item.
- Lesson: in its growth years the account used afternoon slots, 7-9 slides and hashtags; today it uses 4:5, no hashtags and a fixed series label. No alt text on any item in any year.

### 23. @dokontextu, context explainers (Verified)
https://www.instagram.com/p/CS92TOgLC5F/ (10 items, 2021-08-24 19:58, 828 chars / 7, 5 hashtags, 5 `?`) and https://www.instagram.com/p/CSr8SWSr7KL/ (9 items, 2021-08-17 21:04, 2,065 chars / 8, 5 hashtags) · 18.2K followers · 1:1 · caption ends with a designer credit line ("Grafika") and a donation appeal.
- Hook: a factual lead sentence, then a set of questions the carousel answers. Curiosity via explicit questions.
- Structure (secondary, Médiář 2021): what happened, why it matters, what the institution actually does; three editors review each other's posts; three carousels a week.
- Lesson: the closest Czech precedent for an "explainer" register with credits. Engagement stayed in the hundreds.

### 24. @dokontextu, the closing post (Verified)
https://www.instagram.com/p/Cp0glTjLjl-/ · 10 items · 1:1 · 325 / 5 · Wed 15 Mar 2023 19:57 · 2,288 / 94 (its best-performing post among those fetched).
- Lesson: the project announced its end after about two and a half years; the account has posted nothing since (profile embed). A carefully made explainer without distribution or a face plateaued at about 18K. Evidence for pairing the explainer register with sendable covers or Reels, not against the register itself.

### 25. @refreshernews.cz, politics explainer with a context line (Verified)
https://www.instagram.com/p/Dev9nPgimTz/ · 64.4K followers · 5 items · 4:5 · 468 / 3 · 0 hashtags · one leading topic emoji · a second paragraph opening with an informal "by the way" that explains the institution · photo credit line · Wed 21 Oct 10:19 · 933 / 37.
- Hook: the news fact with its small twist (got in on the second attempt). Story family.
- Lesson: Czech's best per-follower news brand (sweep-czech) writes the whole story in the post, adds one line of institutional context, credits photos, and uses no hashtags. A "context line" is a transferable device.

### 26. @refreshernews.cz, viral-moment story (Verified)
https://www.instagram.com/p/DewoKZ5CpIY/ · 4 items · 4:5 · 369 / 3 · 0 hashtags · photo credits naming four sources · Wed 21 Oct 16:31 · 349 / 1.
- Hook: a politician's plan that backfired. Story with a turn.
- Lesson: credits every picture source by name in the caption, the habit DNESKAi's sources slide formalises.

### 27. @seznamzpravy, three-slide news cards (Verified)
https://www.instagram.com/p/Dew5RcsCmW4/ (Wed 21 Oct 19:00, 575 / 77, 291 chars, pointing-hand emoji as bullets, photographer credit) and https://www.instagram.com/p/Dewyd0mCieq/ (18:01, 183 / 5, ends with a "more on our site" line) · 103K followers · 3 items each · 4:5 · 0 hashtags.
- Hook: a human-stakes lead (a fallen soldier identified by his tattoos) versus a party-politics lead. The human-stakes post drew about three times the likes and fifteen times the comments within hours.
- Lesson: three slides is the house standard; emoji bullets structure the caption. The human-stakes vs institutional gap mirrors what sweep-global saw on Evolving AI's LinkedIn.

### 28. @czechcrunch, AI-startup profile (Verified)
https://www.instagram.com/p/DexCowMAFoM/ · 67.6K followers · 6 items · 4:5 · 212 / 3 · 1 branded hashtag · link to the site and bio · Wed 21 Oct 20:22 · 34 / 1.
- Hook: a founder's then-and-now arc tied to an AI product. Story family.
- Lesson: DNESKAi's nearest Czech competitor on AI news posts frequent 6-7 slide carousels (the profile embed shows three carousels in about a day) that drive to the website; engagement per post is very low for its size. Link-out carousels underperform full-story carousels in this sample.

### 29. @cervenapropiska, language series (Mixed)
https://www.instagram.com/p/DeEsyDgAB-d/ · 97.4K followers · 4 items · 4:5 · caption is one question to readers · Sun 4 Oct 15:04 · 121 / 8.
- Pattern (secondary, sweep-czech): one narrow subject, a named recurring series, one owned symbol (the red pen), text-only posts that need no photography.
- Lesson: text-only carousels can carry a brand when the series and symbol are fixed. Relevant to DNESKAi's frequent text-only items.

### 30. @petrmara, Czech tech creator (Verified)
https://www.instagram.com/p/Deb5HzmAlyk/ · 165K followers · 4 items (1 video) · 3:4 · 22-character caption · Tue 13 Oct 15:15 · 2,805 / 88. The other recent grid items are reels.
- Hook: product name plus a short note that it is not available in the EU. Value family.
- Lesson: the leading Czech tech personality is reel-first; carousels are occasional product notes. The "availability in Czechia/EU" angle is a native Czech hook DNESKAi can use when the evidence states it.

## D. Structure and craft references

### 31. @hundredth, the textbook 10-slide anatomy (Mixed)
https://www.instagram.com/p/Ce4YxZwOv_1/ · 10 items · 4:5 · 155 chars · photographers credited · Thu 16 Jun 2022 23:21 · 3,869 / 306.
- Structure (secondary, Future Social 2023-10-04, re-read this session): slide 1 is a standalone title image; slide 2 states the purpose with an arrow as the swipe cue; slides 3-9 repeat the same three elements (photo, two short bold sentences, small fine-print extra); slide 10 is a big type reveal that is shareable on its own.
- Lesson: slide 2 as a second cover and a repeated three-element middle are the transferable parts.

### 32. @markmanson, text-card essay (Mixed)
https://www.instagram.com/p/CfG8cekMD4-/ · 5 items · 4:5 · 77-char caption restating the thesis · 12,974 / 90.
- Pattern (secondary, Future Social): a big hook statement on slide 1 for writing-led carousels.
- Lesson: type-only carousels work when slide 1 is one strong sentence; relevant to the statement kit.

### 33. @nathanwpylestrangeplanet, two-slide comic (Mixed)
https://www.instagram.com/p/CeEbR-xLY_D/ · 2 items · 1:1 · 17-char caption · 40,805 / 106.
- Pattern (secondary, Future Social): slide 2 offers a related extra. Shows that a two-slide carousel is a legitimate unit.

### 34. @metricool, data-study carousel (Verified)
https://www.instagram.com/p/CxGeHpoLBSd/ · 35K followers · 10 items · 4:5 · 623 / 6 · 10 hashtags, 4 `?` · Tue 12 Sep 2023 20:02 · 32 / 2.
- Hook: a study label and a binary question (post or carousel). Curiosity via question.
- Lesson: a ten-slide statistics deck with a hashtag block and questions earned very little; data alone is not a hook.

### 35. @beautymavenraven, Instagram's own Edits example (Mixed)
https://www.instagram.com/p/DcbzoNfluXC/ · 112K followers · 6 items (1 video) · 3:4 · 308 chars · 3 hashtags · Mon 24 Aug 21:24 · 391 / 66.
- Design (Meta's Edits blog, 2026-10-07, re-read via a reader proxy): the editor lets a photo bleed from one slide into the next and a headline run across slides, and carries saved presets (adjustments, colours, audio, text styles) across projects; this creator's carousel is cited for stickers and a signature typeface.
- Lesson: Instagram's own direction for carousels is continuity across slide edges and a fixed visual identity; it also confirms 3:4 as the native app format.

### 36. Our World in Data, Data Insight card (Verified)
https://ourworldindata.org/data-insights/foreign-aid-contributions-fell-in-2025-amongst-almost-all-of-the-top-10-donors (2026-09-26) · the web twin of their Instagram cards (entry 14).
- Pattern: finding as title; exactly one chart; short plain text; "data source (year), licence" line; alt text that states the finding rather than describing the chart type only.
- Lesson: the model for DNESKAi's explainer kit's figure slide and for its alt texts.

### 37. Growth.design, case-study story (Verified)
https://growth.design/case-studies/5-product-onboarding-mistakes-to-avoid (2019-07-03).
- Pattern: a cover with a reading-time label ("story duration"), numbered beats on every frame, bold key phrases, one takeaway per beat, and a closing frame confirming completion.
- Lesson: a reading-time or slide-count label on the cover is a calm, honest swipe promise ("6 slidů, 1 minuta") that needs no question or exclamation mark.

## Profile-embed format snapshot (22 October 2026, latest grid items)

Counted from public profile embeds; children of a carousel are not counted separately.

| Account | Latest items seen | Mix |
|---|---|---|
| @techcrunch | 6 | 6 video |
| @bbcnews | 6 | 6 video |
| @reuters | 6 | 6 video |
| @tiffintech | 6 | 6 video |
| @theapplehub | 6 | 6 single images |
| @theeconomist | 6 | 5 single images, 1 video |
| @axios | 6 | 3 video, 3 single images |
| @nytimes | 6 | 1 carousel, 2 video, 3 single images (approx.) |
| @tldr_newsletter, @therundownai, @czechcrunch, @refreshernews.cz | 4-6 | mostly carousels |
| @petrmara, @jsemvobraze, @seznamzpravy | 6 | mostly video, some carousels |
| @denikn | 6 | single images, the newest from 2021 (the embed shows no recent activity) |
| @ct24 | - | embed returned nothing |

## What the board says, in one paragraph

Text-first news accounts that post carousels today (TLDR, The Rundown, Refresher, Seznam Zprávy, CzechCrunch, NYT for data) use 2-6 slides at 4:5, put the full story in the caption, and use zero hashtags; three of them end the caption with an explicit source or image-credit line. Brands with design teams (Impact, Our World in Data, Mosseri himself) have moved to 3:4, which the app accepts but the Graph API does not. Covers are carried by a declarative finding, an attributed quote or a human-stakes lead; questions and exclamation marks appear mainly on creator and Czech personal accounts. The big broadcasters' grids are now video-first. Nothing here measures saves or sends; those need the owner's own Insights.

## Sources opened in this session (2026-10-22)

Instagram public embeds (post and profile) for every post and handle named above; Meta developer docs (content-publishing; ig-user/media reference); help.instagram.com articles 1223433768344104 and 1631821640426723 (read through r.jina.ai); threads.com/@creators/post/DSalXGPCWM4; edits.instagram.com/blog/edits-carousel-editor (via r.jina.ai); ourworldindata.org data-insights page and entry; growth.design case study; futuresocial.beehiiv.com/p/instagram-carousel-storytelling; mobileanddigitaljournalism.substack.com/p/the-carousel-post-an-overview; dataconomy.com (per-slide captions, 2026-06-19); niemanlab.org reading note on the Globe and Mail test (via r.jina.ai). Secondary descriptions taken from the research sweeps are named in each entry.
