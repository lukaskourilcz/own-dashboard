# DNESKAi carousel playbook

Workstream E (research), 22 October 2026. Distilled from the reference board (`reference-board.md`, 37 examples), the nine research sweeps in `dneskai-audit-handoff/research/`, Quorum's GoVIRAL method, hook records and carousel frameworks, and the five-kit ADR (`dneskai-audit-handoff/engine/ADR-final.md`). It proposes; it changes no prompt, register, ceiling or code. Register choices in section 8 are options for the owner.

The account is a calm, trustworthy Czech AI and tech briefing with no face, four posts a day, a code-written sources slide and hard truth rules. Every recommendation below has to survive those facts.

## 1. The seven rules

1. **Slide 1 states one concrete thing; slide 2 is a second cover.** The cover carries one declarative finding, change or attributed number. Slide 2 must stand alone, because Instagram may re-serve a carousel from slide 2 to people who did not swipe (Mosseri, October 2024). Never spend slide 2 on a transition.
2. **Write for the send, not the comment.** Instagram names watch time, likes and sends as its top three ranking signals, with sends weighing more for reach beyond followers (Mosseri, January 2025, caption verified). A DNESKAi post earns a send when one slide is forwardable on its own: a dated change that applies to someone, an attributed figure, a "what this means in Czechia/EU" line. Questions and comment prompts raise comments, a signal Instagram ranks below these.
3. **Four to six slides, one idea each, plus the sources slide.** Current text-first news carousels run 2 to 6 items (TLDR 4, Rundown 2-4, Seznam Zprávy 3, Refresher 4-5, NYT 3). Use 2-3 for a single fact, 5-6 for an explainer, never pad toward the 7-slide ceiling.
4. **The whole story lives in the post.** Czech's best news account per follower (Refresher) and the fastest AI accounts put the complete story in slides and caption; link-out carousels in the sample (CzechCrunch) earn the least. DNESKAi's no-URL rule is already right.
5. **Sources visible twice: on the slide and in the caption.** TLDR, The Rundown, NYT, Refresher and Seznam all end captions with a source or credit line; TLDR separates text sources from image sources. Keep the code-written sources slide, put a short source label on every inner slide, and close the caption with sources and picture credits.
6. **Five hashtags at most, topical, as search terms.** Instagram allows 5 per post since 18 December 2025 (@creators, verified). The text-first news accounts on the board use none. Today's code emits up to 10 (`dneskai-generation.ts:388-391`).
7. **One recognisable series grammar across the grid.** Fixed series label, fixed furniture (logotype, folio, source label), one kit per post, 4:5 safe for the 3:4 grid crop. Recognition comes from repetition (TLDR's 4-item template, @jsemvobraze's fixed furniture, The Economist's per-type templates), not from louder covers.

## 2. Current platform numbers (checked 22 October 2026)

| Item | Current value | Source and status |
|---|---|---|
| Carousel size | Up to 20 images or videos | Meta developer docs, content-publishing and ig-user/media reference, opened 2026-10-22 |
| API image spec | JPEG, max 8 MB, aspect 4:5 to 1.91:1, width 320-1440 px, sRGB | ig-user/media reference, opened 2026-10-22 |
| App upload range | 1.91:1 to 3:4 (1080 wide, 566-1440 high) | help.instagram.com/1631821640426723, read 2026-10-22 |
| Profile grid | Centre crop to 3:4 tiles since January 2025 | Third party (Business Today 2025-01-21, Kapwing 2025-12-30, Hopper HQ 2026-09-18) via sweep-platform; no Meta page states it |
| Carousel crop | Every child cropped to the first image's ratio; orientation is set once per post | Meta developer docs (opened); Help Center via sweep-platform |
| Caption | 2,200 characters; API still documents 30 hashtags and 20 @-tags | ig-user/media reference, opened |
| Hashtags in practice | Up to 5 per post or reel, since 2025-12-18 | Threads @creators post DSalXGPCWM4, opened |
| Per-child captions | Not supported on carousel children through the API | ig-user/media reference, opened |
| Per-slide captions in the app | Optional toggle, rolled out from 2026-06-18 | Press only (Dataconomy 2026-06-19, opened); app-only, not reachable by DNESKAi's API publisher |
| Alt text | Up to 1,000 characters per image, carousel children included | ig-user/media reference, opened |
| Music on carousels | App: yes for photo-only carousels; "music cannot be added to carousels with videos" | help.instagram.com/iphone-app/1223433768344104, read 2026-10-22 |
| Music through the API | No audio parameter for images or carousels; audio only on Reels | sweep-metaapi, Meta docs opened 2026-10-22 |
| Music after publishing | "Replace Audio" on published feed posts and carousels since 2026-07-21; library tracks only | Press and vendor blogs via sweep-metaapi; untested on a post that never had audio |
| Music and the Reels tab | Music on carousels and photos makes them eligible for the Reels tab | Mosseri's own caption on DBOeUmTSmIC (October 2024), opened via public embed; possibly outdated |
| Second chance | Non-swipers may be shown the carousel again from slide 2 | Mosseri reel October 2024, quoted by Mashable/Yahoo (secondary); his caption confirms "two main reasons" |
| Ranking signals | Watch time, likes, sends; sends weigh more for unconnected reach | Mosseri DFFyRp-pINJ caption (January 2025), opened |
| Sends | "One of the biggest signals we use in ranking" | Mosseri C86WDnEuBjB caption (2024), opened |
| Safe zones | Meta publishes none for 4:5 feed carousels. Reels ads: keep ~14 % top, 35 % bottom, 6 % each side free | Meta Ads Guide via sweep-platform (9:16 only) |
| Grid-crop margin (own calculation) | A 4:5 cover shown as a 3:4 tile loses ~34 px per side at 1080 wide | sweep-platform calculation |
| Originality | Carousels count; designed slides and "unique text that provides more context" are original; reused press photos with only a credit are not | creators.instagram.com, 2026-04-30, via sweep-platform |
| Publishing quota | 50 or 100 API posts per 24 h (the docs disagree); read `content_publishing_limit` | Meta developer docs, opened |

Practical consequences: render at 1080 × 1350; keep logotype, folio and headline edges at least 64 px from the left and right edges of the cover (grid crop plus air); keep slide-1 headlines out of the bottom ~12 % where the feed's dots and caption sit close; keep every slide photo-only if music will be added later.

## 3. Hook families: what fits and what does not

Families from GoVIRAL (`quorum/orchestrator/prompts/goviral.md:24-29`), mapped to DNESKAi's evidence rules in sweep-quorum §1. Every hook must be closed by slide 2 from the evidence.

| Family | Fit | Use it like this | Board examples |
|---|---|---|---|
| Value (the fact itself) | Strong | "[Nástroj]: nová funkce, zdarma od [datum]." The payoff in line one; the most honest hook. | Rundown (5), TLDR (6), metaglasses (9) |
| Social proof (attributed number) | Strong when the number is in the evidence | Finding plus figure plus who says so. | Rundown study (4), NYT poll (10) |
| Story (dated third-person moment) | Strong for money, regulation, Czech angle | A date, an actor, an action; the reason on slide 2. | Refresher (25, 26), Daily Aus (11) |
| Curiosity (concrete gap) | Usable under rules | "Nařízení má [N] stran. Rozhoduje jeden odstavec." Only when slide 2 names the paragraph. | Seznam human-stakes lead (27) |
| Attributed quote | Usable | A short quote with speaker and role on the same slide, only when the quote is in the evidence. | Guardian (15), Impact (13) |
| Contrarian | Narrow | Only headline-versus-document, with both in the evidence. | none on the board in a calm register |
| Human stakes / "what it means for you" | Strong if the evidence says who is affected | Who is affected and from when. No reader claims. | Seznam (27), Evolving AI LinkedIn (sweep-global) |
| Question to the reader | Not in the current register | Measurably raises comments (Metricool 2026, +36.7 %), which rank low. See register options. | jsemvobraze (22), dokontextu (23), metricool (34) |
| Alarm / superlative ("one of the biggest...") | Does not fit | Inflated significance; the humanizer bans it. | Evolving AI (1) |
| Second-person "you're doing it wrong" | Does not fit | Unverifiable reader claim. | Superhuman (7) |
| Face, emoji, personal voice | Does not fit | DNESKAi has no person; the emoji and first person break the register. | jsemvobraze (20, 21) |

Four posts a day exhaust any small hook library fast: Quorum's twelve news hooks rest 16-24 days each and run dry by day three (sweep-quorum §1.4). Treat the plain declarative headline as the default cover, with a tagged hook family as an enhancement, not a requirement.

## 4. Structure

**Carousel (2 to 7 written slides plus sources).**

| Position | Job | Pattern |
|---|---|---|
| 1. Cover | Stop the scroll in under two seconds; works alone as the grid tile | Kicker (series or topic label, ≤ 44 chars) + one declarative headline (aim ≤ 66 chars, ceiling 110) + picture if one exists. No body text. |
| 2. Second cover | Close the cover's gap; stand alone if re-served | The key fact with its number or the quote, attributed. |
| 3 to N-1 | One beat each | "Co se změnilo", "Proč na tom záleží", "Co zatím nevíme", "Co to znamená pro Česko" (only when the evidence says so). One figure or one quote per slide. |
| N (code) | Sources | Publisher, title, date per source; picture credits; AI-disclosure line. Already code-written. |

**Single-fact item: 2 to 3 slides** (cover, fact or quote card, sources). The PoliticsJoe and Rundown two-slide units show this is a legitimate size, and a single image loses to a short carousel on every 2025-2026 dataset (sweep-benchmarks §1).

**Caption.** Keep the current fixed shape (what happened, why it matters, what is still open; 300-700 characters), and make the first line work as a hook in its own right: the feed folds at about 125 characters. Close with sources and picture credits as two short lines (TLDR's text/image split), then at most five hashtags. Reading-time or slide-count labels ("5 slidů") are honest swipe promises when code computes them.

**Alt text.** Write each alt text as the slide's finding, not a description of the layout (Our World in Data pattern). The API takes 1,000 characters per child; the evidence-based alt texts already in the pipeline qualify.

**Posting time.** The Czech peers on the board posted between 10:00 and 22:00 Prague (derived from post ids); US-based AI accounts land 15:00-01:00 Prague. Vendor windows (Sprout 2026, Hootsuite CET 2026) favour weekday 12:00-18:00 and evenings. Keep 08:00 / 12:30 / 17:00 / 20:00 until the account's own Insights exist; test 08:00 against 09:00 first, because no dataset supports an 08:00 carousel and the Czech peers do not use it.

## 5. Visual patterns

**Fit.**
- Flat grounds from the brand palette; one accent colour per post; a ground sequence across slides as a quiet swipe device (the flat version of @jsemvobraze's coloured-paper sequence).
- Marker-style highlight behind numbers with their units and named entities that appear in the evidence (code-derivable).
- A flat "source card": publisher in mono, the article headline from the feed, the date; square corners, no screenshot of the publisher's page.
- One chart or one big number per figure slide, finding as headline, mono source line at the bottom (Our World in Data, NYT).
- Quote card: quote, name, role, source; a portrait only when a stored, credited source photo exists.
- Same furniture on every slide: logotype, folio, short source label.
- Full-bleed photo with a text band on the cover when a picture qualifies; type-only cover when none does. Both must look intentional; text-only is a normal case, not a fallback.
- 1080 × 1350 for API publishing; 3:4 only after a one-post API test (owner item).

**Do not fit.**
- Gradients, glow, grain, collage and stickers (the 2020 slideshow genre and Impact's youth identity; also forbidden by the flat kit rule).
- Rotated or taped screenshots of publishers' pages (rights and originality: Instagram's 2026 originality rule treats screenshots with a credit as unoriginal).
- Handwriting, hand-drawn arrows, memes, emoji, rounded photo frames.
- Mixed aspect ratios inside a post (the API crops every child to the first).
- Photo-realistic AI people (recommendation penalty without the AI-profile label).
- Video items in a carousel that should take music later.

## 6. The five kits

Kits are per post (owner rule 9); variants stay per slide. All five share one copy deck within `DNESKAI_TEXT_LIMITS` (ADR §6.2), so the board's density limits apply to all. Kit ids are the ADR's: editorial, bold, explainer, magazine, ticker. I call the magazine kit "clipping" below because the board supports a flat clipping grammar, not a collage.

| Kit | Best content | Cover | Inner slides | Slide count | Swipe device | Hook family | Board references |
|---|---|---|---|---|---|---|---|
| **Editorial** (default) | Photo-rich events, product launches with good pictures | Full-bleed photo, text band, kicker + headline | Split photo/text, figure, statement | 4-6 + sources | Folio and continuing photo crops | Value, story | NYT (10), Daily Aus (11), Refresher (25) |
| **Bold / statement** | One strong claim, few or no pictures, regulation, a quote | Type-only: one sentence at display size on a flat brand ground | One statement per slide, short body under it | 3-5 + sources | Ground-colour sequence | Value, attributed quote, human stakes | Mark Manson (32), Guardian (15), PoliticsJoe (16) |
| **Explainer** | Research results, rules, "how it works" | Finding as headline + "N slidů" label | Labelled sections (Co se stalo / Proč na tom záleží / Co nevíme), one chart or big number per figure slide, mono source line | 5-7 + sources | Numbered section labels | Social proof, curiosity, value | Our World in Data (14, 36), TLDR (6), dokontextu (23), Growth.design (37) |
| **Clipping / magazine** | Stories reported by several outlets; roundups; secondary coverage worth comparing | Kicker + headline over a stack of flat source cards | One source card per slide (publisher, headline, date) with the fact it adds, highlight on numbers | 4-6 + sources | Card stack shifting slide to slide | Story, headline-versus-document contrarian | @jsemvobraze furniture and clippings (20), Refresher credits (26) |
| **Ticker** | Single facts, low-resolution or no pictures, fast news | Mono kicker with date and topic, short headline, no picture or a small inset | One fact card, then sources | 2-3 + sources | None needed | Value, attributed number | Rundown (4, 5), metaglasses (9), TLDR 4-item template (6) |

Behaviour with pictures: editorial needs one full-bleed picture and degrades to the bold cover with none; bold and ticker never need one; explainer uses pictures only as figure insets; clipping uses no photos at all (its "pictures" are code-drawn source cards), which makes it the safest kit for low-resolution og:images.

Which kit to suggest by default (for the Design Lab, still the owner's pick): picture count ≥ 2 and photo-led story → editorial; 0-1 pictures and one claim → bold; a number or a study → explainer; three or more secondary sources → clipping; one fact or low-resolution picture → ticker.

## 7. Captions, music and distribution

- **Caption first line:** the cover's claim restated in fuller form, ≤ 125 characters, no question in the calm register.
- **Credits:** "Zdroje:" then "Foto:" as the closing lines, as already appended by code.
- **Hashtags:** ≤ 5: one branded (#dneskai), two to four topical; diacritics in hashtags are normal Czech practice (sweep-czech §7) but the code normalises to ASCII, so keep ASCII until someone verifies whether Instagram treats the two forms as one tag.
- **Music:** the API cannot attach it. The one path that keeps the approved bytes is publish by API, then add a library track with Replace Audio in the app (about 30 seconds per post). Mosseri's caption ties music to Reels-tab eligibility. Keep music-intended decks photo-only. Pilot once before relying on it.
- **Threads:** a second surface for the same deck (20 images, alt text) with replies as the documented signal; a question in the register belongs there if anywhere (sweep-metaapi, sweep-quorum §3.2).

## 8. Register options for the owner

The current register (`dneskai-generation.ts:122`) forbids questions, exclamation marks, emoji, greetings and calls to follow or comment. All three options keep every truth rule unchanged: every number and quote from the evidence, no background knowledge, each claim as strong as its source, attribution of uncertain claims, no invented first person, no picture descriptions, the code-written sources slide, no URLs in slides. None of them is applied; the owner decides.

### Option A: Calm (today)
- Allowed: declarative value, attributed number, dated third-person story, attributed quote, headline-versus-document contrast.
- Cover: a plain declarative headline.
- Precedents: BBC News' text-on-image era, The Daily Aus, TechCrunch, The Rundown, TLDR.
- Strength: unique among Czech news-explainer accounts (sweep-czech §9), consistent with the truth gates, compatible with the humanizer.
- Weakness: covers drift toward summaries; TechCrunch shows a calm, flat account can stall at +1K followers a year.
- Prompt change: none.

### Option B: Calm plus hook cover
- Everything in A, plus: slide 1's headline is written as a declarative gap that slide 2 closes ("Nařízení má 140 stran. Rozhoduje jeden odstavec."); the kicker becomes a fixed series label (Model, Studie, Regulace, Peníze, Nástroj, Česko); code may add an honest swipe promise from the deck ("5 slidů").
- Still banned: question marks, exclamation marks, emoji, CTAs, superlatives, "first/breaking", any gap the evidence cannot close.
- Precedents: Reuters' "punchy first sentence inside three seconds", The Rundown's finding-first covers, Growth.design's duration label.
- Cost: a `hook` family tag on the slide schema so code can cap any family at 20 % and enforce cooldowns, and a carve-out in the humanizer's "canned hooks" line for a tagged slide-1 line (sweep-quorum §5).
- Recommended as the first test if the owner wants more reach without touching tone.

### Option C: Explainer
- Everything in B, plus: fixed labelled sections; one question allowed on the cover only when it is about the event (not the reader) and slide 2 answers it from the evidence ("Co přesně nový zákon zakazuje?"); one overview slide before the detail; one context line explaining the institution or term (the Refresher "by the way" device, in a neutral voice).
- Still banned: exclamation marks, emoji, CTAs, reader claims ("you use this every day"), questions the deck does not answer.
- Precedents: Do kontextu (closest Czech precedent; stayed at ~18K and ended in 2023), NYT and Axios-style labelled cards, Our World in Data.
- Risk: more slides and more text per post; the explainer kit carries it, the ticker kit does not.

**Not offered:** a creator register (first person, emoji, exclamation marks, comment prompts, "send this to someone"). It breaks the humanizer's bans and the truth rules, and the board shows its gains are in comments, which rank low.

## 9. How to know what works (no Insights scope today)

- Public numbers (likes and comments on own posts) can be read daily with the existing basic scope; saves, sends and reach need the Insights scope (owner decision, sweep-metaapi).
- Until then, record per post: kit, hook family, slide count, cover type (photo or type), register option, slot. Rotate kits and hook families evenly over four weeks so a month-end comparison is possible (task I).
- Owner-entered Insights after 48 hours (sends, saves, reach) for at least one post a day is the only way to rank by the signals Instagram says matter.

## 10. Owner decisions this playbook raises

1. **Register:** A (calm), B (calm plus hook cover) or C (explainer). Recommendation: test B.
2. **Hashtags:** reduce the code's ceiling from 10 to 5 to match Instagram's cap (`dneskai-generation.ts:31,102,133,388-391`). Today a post can go out with up to 10; what the API does with the extras is unverified.
3. **3:4 renders:** one API test post at 1080 × 1440 before any kit adopts the grid-native ratio; the API documents 4:5 as its limit.
4. **Music:** pilot Replace Audio on one published, photo-only carousel.
5. **Slot test:** 08:00 against 09:00 once Insights or a month of public numbers exist.

## Sources

Opened in this session (2026-10-22): Meta developer docs (content-publishing; ig-user/media reference); help.instagram.com 1223433768344104 and 1631821640426723 (via r.jina.ai); threads.com/@creators/post/DSalXGPCWM4; Mosseri's public embeds DBOeUmTSmIC, DFFyRp-pINJ, C86WDnEuBjB, C-sQPoCPZnV; dataconomy.com/2026/06/19/instagram-adds-unique-captions-carousel-slides/; every Instagram embed and web page listed in `reference-board.md`. From the sweeps (fetched by other agents on the same date): sweep-platform (grid crop, safe zones, originality), sweep-metaapi (music, Replace Audio, quotas), sweep-benchmarks (format, caption, hashtag and timing studies), sweep-czech (Czech market, typography, hashtag practice), sweep-brands, sweep-global, sweep-quorum, sweep-jsemvobraze. Code read: `src/lib/marketing/dneskai-generation.ts` in this worktree.

WebSearch calls used by this workstream: 9 of 40.
