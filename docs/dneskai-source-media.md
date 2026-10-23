# DNESKAi: obrázky ze zdrojů

Sběr ([dneskai-source-collection.md](dneskai-source-collection.md)) ukládá u kandidátů jen
odkazy. Tento krok (#114) stáhne obrázky vybraných témat, uloží je beze změny a zapíše
původ, pořadí, rozměry a credit. Na tyto byty se pak odkazuje balíček slidů
(`assetSha256` v `dneskai-slides.ts`) a renderer je před vykreslením znovu ověří.

Rozhodnutí vlastníka 7 (#110): obrázky ze zdrojových příspěvků se používají i bez
vyjasněných práv. Gate práv tu není. Původ (`origin_url`, `origin_kind`, zdroj,
externí id) a credit se ukládají vždy.

## Kdy se stahuje

`collectDneskaiMedia(db, owner, project, candidateIds, deps)` v
`src/lib/marketing/dneskai-media.ts` bere nejvýše osm kandidátů a stahuje jen ty se
stavem `selected`. Plánovač (#120) ji zavolá hned po doběhnutí sběru, ještě tutéž
noc: odkazy na Instagram CDN vyprší za 24 až 48 hodin a uložené odkazy z 13. 10. už
vracejí 403. Kandidát sebraný v jednom běhu a vybraný až v pozdějším může mít odkazy
starší než den a skončit jako `media-http-403`.

První nativní noc (21. 10.) vrátil web OpenAI na načtení stránky článku `media-page-http-403`
u obou vybraných událostí z `openai-blog`. Jeho RSS nenese obrázek, takže tyto události
zůstaly bez fotografie; stránky Anthropic a TechCrunch prošly.

Po nasazení plánovače (#120, [marketing-scheduling.md](marketing-scheduling.md)) ji volá
jeho tick: každých pět minut jedno `collectDneskaiMedia` s rozpočtem nejvýše 40 s, po `busy`
čeká 125 s a po chybě deset minut. Retenci `purgeUnusedDneskaiMedia(db, owner, 30)` spouští
denní tick jen tehdy, když žádný kandidát nedrží zámek sběru médií. The deployed state must be checked against dated production evidence; the code path exists in `scheduler-ports.ts`.

Které kandidáty předat, řekne `pendingDneskaiMediaCandidates(db, owner, project)`:
vybrané kandidáty pro dnešní nebo pozdější pražský den, jejichž stahování nezačalo nebo
ještě není hotové, nejvýše osm. Plánovač volá sběr, dokud seznam není prázdný, ale
ne hned znovu: kandidát `busy` drží jiný průchod, takže další pokus má smysl až po konci
jeho zámku (120 s). Průchod s přechodnou chybou (429, 5xx, timeout) má plánovač opakovat
s odstupem několika minut, jinak všechny tři pokusy proběhnou během pár sekund.

Volání má časový rozpočet (výchozí 50 s, nejvýše 90 s). Když dojde, nové stahování
nezačne, výsledek má `complete: false` a další volání pokračuje jen otevřenými pozicemi.
Hotový kandidát se znovu nestahuje vůbec: opakovaný běh nic nestáhne ani nenačte stránku
znovu.

Kandidát je po dobu jednoho průchodu zamčený na 120 s (`marketing_media_begin`).
Stahování obrázku začne, jen když by i v nejhorším případě (adresa i záložní adresa
vyprší po 15 s, nahrání do úložiště po 15 s) skončilo před koncem zámku. Když zámek
přesto vyprší, kandidát zůstane `pending` s kódem `media-lease-lost` a volání pokračuje
dalším kandidátem.

## Co se stahuje

**Instagram:** the collector keeps carousel children first, then unique fallback `images[]` and display renditions, at most ten. Known Instagram CDN filenames are deduplicated before that cap, so a repeated display rendition cannot displace the tenth child. Downloads remain limited to `cdninstagram.com` and `fbcdn.net`; identical downloaded bytes are still stored once.

**Feedy:** stránka primárního článku se načte jednou a z ní:

1. `og:image` a `twitter:image`,
2. obrázek, který dal feed sám (`mediaUrls`),
3. obrázky v těle článku (`<figure>`, `<picture>`, `<img>`) v pořadí dokumentu.

Nejvýše osm obrázků. Bere se největší varianta ze `srcset`; u WordPressu
(`/wp-content/uploads/`) se nejdřív zkusí adresa bez parametrů zmenšení a při
neúspěchu adresa vydavatele. Hosty jsou jen doména vydavatele (stránky nebo zdroje
v registru) a jeho známé CDN (`PUBLISHER_IMAGE_DOMAINS` v `dneskai-media-plan.ts`).
Obrázkové proxy (WordPress Jetpack `i0.wp.com/<host>/…`, Substack
`substackcdn.com/image/fetch/…`, GitHub camo) zmenšují libovolný veřejný obrázek, proto
u nich rozhoduje host, který nesou: musí to být doména vydavatele nebo jeho CDN.
Obrázek z neznámého hostu se do plánu nedostane, nehádá se. Takové obrázky se
zapíšou jako jeden záznam `media-host-not-publisher` s pozicí -1, počtem (`count`)
a nejvýše pěti hosty (`hosts`), aby šlo seznam CDN rozšiřovat podle dat. Vynechávají se
avatary, loga, ikony, autorské a sdílecí bloky, navigace, patička, SVG, GIF a obrázky
deklarované nebo skutečně menší než 300 px. Logo nebo ikona se poznají podle složky
(`/avatars/`, `/icons/`) nebo krátkého názvu souboru (`logo.png`, `site-logo-dark.png`,
`favicon-32x32.png`). Redakční fotka s popisným názvem, který logo jen zmiňuje
(`openai-logo-GettyImages-1234.jpg`), se stáhne.

Když stránka vrátí přechodnou chybu (timeout, 429, 5xx), zkusí se v dalším běhu,
celkem nejvýše třikrát. Potom, nebo hned při trvalé chybě (403, 404), zůstane jen
obrázek z feedu. Pořadí a seznam obrázků se po prvním úspěšném načtení zafixují
(`plan`), takže další běhy pracují se stejnými pozicemi.

Všechny požadavky jdou přes `safeFetch` z `free-feeds/security`: jen HTTPS na portu
443, kontrola DNS na veřejné adresy, připnuté TLS spojení na ověřenou adresu, nejvýše
8 MiB a 15 s na obrázek (3 MB na stránku), image redirects have at most two hops. Every hop repeats the publisher/known-CDN URL policy, HTTPS/public-DNS checks and TLS pinning. Article-page redirects keep their separate, narrower page-host rule.

## Co se ukládá

Privátní bucket `marketing-media` (JPEG, PNG, WebP, nejvýše 32 MiB, stejně jako
`DNESKAI_MAX_IMAGE_BYTES` ve studiu). Bucket `marketing-assets` s vykreslenými JPEGy
se nemění. Objekt `marketing-media/<owner>/<sha256>.<ext>` obsahuje původní byty beze
změny; sha256 těchto bytů je identita média.

| Tabulka | Obsah |
|---|---|
| `marketing_media_assets` | jeden řádek na obrázek vlastníka (`sha256` unikátní), první výskyt: kandidát, zdroj, externí id, `origin_url`, `origin_kind`, `position`, rozměry po EXIF orientaci, MIME, velikost, cesta, credit, `fetched_at`, `phash`, `duplicate_of_asset_id`, `purged_at` |
| `marketing_media_asset_links` | každé použití obrázku kandidátem s vlastní pozicí, původem a creditem; obrázek pro dva kandidáty je uložený jednou |
| `marketing_media_collections` | stav kandidáta: `pending`, `complete`, `partial`, `failed`, `empty`, pevný plán, přeskočené pozice s kódem a počtem pokusů, stav stránky |

`origin_kind`: `instagram-display`, `instagram-child`, `og-image`, `article-figure`,
`feed-image`. `position` je pořadí v původním carouselu nebo článku od nuly.

Vlastník čte jen své řádky (RLS), zápis jde jen přes funkce pro service role
(`marketing_media_begin`, `_set_plan`, `_record_asset`, `_finish`, `_lookup`,
`_pending_candidates`, `_claim_purge`, `_unmark_purge`). Nový sha256 se zapíše až po nahrání objektu.

## Duplicity a rozlišení

- Stejné byty (sha256) jsou jeden asset.
- Blízký pHash (64bitový DCT hash, Hammingova vzdálenost ≤ 6) označí menší kopii
  `duplicate_of_asset_id` na větší, která zůstává kanonická. Typicky `displayUrl`
  proti `images[0]` v jiném rozlišení nebo stejná tisková fotka u dvou vydavatelů.
- Skupiny jsou ploché a vzdálenost se měří vždy ke kanonickému obrázku, nikdy přes
  souseda. Nový obrázek se připojí k nejbližšímu kanonickému do 6 bitů, který je
  aspoň stejně velký. Když je největší, převezme menší kanonické do 6 bitů a z jejich
  duplicit jen ty, které jsou do 6 bitů i od něj. Ostatní se přesunou k jinému
  kanonickému do 6 bitů, nebo zůstanou samostatné.
- Značka duplicity je jen nápověda. Různé slidy jednoho carouselu na stejné šabloně
  (bílé nebo černé pozadí, jiný titulek) mají pHash 4 až 6 bitů od sebe, takže je
  značka spojí, i když jde o různé obrázky. Co nabídnout dál (#115, #116, #119), určuje
  `dneskaiOfferableMediaAssets` v `dneskai-media-contracts.ts`: vynechá smazané a jen
  opakovanou kopii téhož obrázku u stejného kandidáta složí do větší. U Instagramu je to
  hlavní obrázek nebo varianta se stejným názvem souboru na CDN, u feedu `og:image` nebo
  obrázek z feedu proti obrázku v těle. Dva obrázky z těla článku ani dva různé slidy
  se nikdy neskládají.
- Vydavatelé `og:image` často jen jinak ořežou nebo rozšíří hlavní obrázek, takže pHash
  vyjde dál než 6 bitů a databáze kopii neoznačí. U Anthropicu 22. 10. 2026 měla karta
  1200 × 630 a hlavní obrázek 1920 × 1080 vzdálenost 12 bitů a carousel ukázal stejnou
  ilustraci dvakrát. Proto `dneskaiOfferableMediaAssets` vynechá `og:image` nebo obrázek
  z feedu, který je od některého obrázku z těla téhož kandidáta nejvýš
  `DNESKAI_CARD_REFRAME_MAX_DISTANCE` (14) bitů. Nesouvisející obrázky mají kolem 32 bitů.
  Platí od dalšího sestavení briefu; uložené briefy a revize se nemění.
- `fullBleedCapable` = kratší strana ≥ 900 px (cover, single). `insetCapable` = šířka
  ≥ 600 px (obrázek v rámu). Menší obrázky se uloží a UI je ukáže jako malé.

## Credit

- Instagram: `Foto: @<ownerUsername>`. U spoluautorského příspěvku je to vlastník
  příspěvku, u starších kandidátů bez tohoto údaje profil zdroje.
- Feed: `Obrázek: <vydavatel>` podle registru („TechCrunch“, „Wired“, „Hugging Face“).
  Agregátor (Hacker News, Spaceflight News) odkazuje na cizí stránku, credit pak nese
  její doménu.
- Příspěvek na platformě patří autorovi: Bluesky `Obrázek: @<handle> (Bluesky)`, GitHub
  `Obrázek: <vlastník>/<repozitář> (GitHub)`. Otázky ze Stack Exchange nesou
  `Obrázek: Stack Overflow`.

- Fotografie agentury (rozhodnutí vlastníka 21, 22. 10. 2026): když obrázek z feedu sám
  jmenuje agenturu, credit uvede agenturu i vydavatele, který ho otiskl:
  `Foto: Getty Images přes TechCrunch`. Partner Getty Images se uvede s ní:
  `Foto: Bloomberg / Getty Images přes TechCrunch`. Když je agentura zároveň vydavatelem,
  zůstane `Foto: Reuters`. Agentury: Getty Images, Reuters, AP, AFP, Shutterstock, Alamy,
  EPA, Bloomberg, ČTK.

  Platí jen výslovné signály daného obrázku (`dneskaiPictureAgency`):
  1. pole creditu vložená v souboru: IPTC By-line, Credit, Source a Copyright
     (`dneskaiEmbeddedCredits` čte záznamy IIM, i uvnitř bloku Photoshopu) a XMP
     `photoshop:Credit`, `photoshop:Source`, `dc:rights`, `dc:creator` a další pole práv;
  2. creditová část popisku nebo alt textu: text za `Image Credits:`, `Credit:`,
     `Photo by`, `Foto:` a podobnými štítky, za `©`, `(AP Photo/…)`, `REUTERS/…` a agentura
     hned za lomítkem nebo za „via“ („Justin Sullivan / Getty Images“);
  3. název agentury jako slovo v cestě obrázku (`GettyImages-2171234567.jpg`,
     `shutterstock_2245.jpg`); krátké názvy (AP, EPA, ČTK) se v URL nehledají.

  Zmínka mimo credit („the Reuters newsroom“) se nepočítá, AP, AFP, EPA a ČTK musí být
  velkými písmeny, a když signály jmenují dvě různé agentury, credit zůstane
  `Obrázek: <vydavatel>`. Nic se nehádá. Instagram a příspěvky na platformách dál
  uvádějí autora. Credit se počítá pro každý obrázek zvlášť při sběru a ukládá se do
  `marketing_media_asset_links.credit`; dřív uložené obrázky si credit nechávají.

Credit není nikdy prázdný a má nejvýše 120 znaků. Zůstává v databázi
(`marketing_media_asset_links.credit`) jako původ obrázku. Od 22. 10. 2026 ho neukazuje
žádný slide ani popisek příspěvku (pravidla vlastníka, `.claude/skills/dneskai-post-content/SKILL.md`).

## Popisek Reelu

Sběr Instagramu nově ukládá `instagram.ownerUsername`, `mediaType` (`image`,
`carousel`, `video`) a `containsVideo`. Read model vrací `captionOnly: true` pro Reel a
video, carousel s videem a starší kandidáty bez typu. Brief (#115) a prompt (#116) pak
text nesmí podat jako přepis videa: je to jen popisek.

## Načítání bytů a retence

`createDneskaiMediaLoader(db, owner)` implementuje `LoadDneskaiMediaBytes` z
`dneskai-ports.ts`: stáhne objekt z bucketu a vrátí ho, jen když sha256 sedí. Jinak
`media-asset-unavailable` (chybí, smazaný, cizí) nebo `media-asset-hash-mismatch`.

`purgeUnusedDneskaiMedia(db, owner, 30)` smaže byty assetů starších než 30 dní, na které
neodkazuje žádná revize (`revision.deck.slides[].images[].assetSha256`, v jakémkoli
stavu) a které žádný kandidát nepoužil v posledních 30 dnech. Nastaví `purged_at`,
řádky, původ a credit zůstávají. Maže se po stovkách objektů. Když dávka v úložišti
selže, značka se vrátí jen jí a dávkám po ní a další denní běh je zkusí znovu. Dávky
smazané před chybou značku drží, protože jejich byty už nejsou. Plánovač ji volá jednou denně, ne souběžně se sběrem.
Stejné byty stažené později se nahrají znovu a `purged_at` se vymaže.

## API

`GET /api/marketing/dneskai/media?projectId=&candidateId=` (session vlastníka) vrací
`dneskai-media/1` (`dneskai-media-contracts.ts`): pro kandidáta, nebo bez `candidateId`
pro nejvýše osm vybraných, obrázky v původním pořadí s creditem, rozměry, příznaky
rozlišení, označením duplicity, stavem stahování a podepsaným náhledem na 1 hodinu.
Podepsaný odkaz slouží jen k náhledu, do revize ani hashe schválení nepatří. Prohlížeč
ho načte přes `loadDneskaiMedia` v `dneskai-client.ts`.

## Kódy stavu

| Kód | Význam | Další pokus |
|---|---|---|
| `media-duplicate-bytes` | stejné byty už jsou na dřívější pozici | ne |
| `media-excluded-format`, `media-excluded-small` | není JPEG/PNG/WebP, animace, kratší strana pod 300 px | ne |
| `media-host-not-publisher` | host není vydavatel ani jeho CDN; u feedů jeden záznam s pozicí -1, počtem a hosty z doby plánu | ne |
| `media-http-403`, `-404`, `-410` | odkaz vypršel nebo neexistuje | ne |
| `media-http-429`, `-5xx`, `media-timeout`, `media-fetch-failed` | přechodná chyba | ano, celkem 3× |
| `media-too-large`, `media-undecodable`, `media-host-unsafe`, `media-redirect-refused` | soubor nebo adresa nevyhovuje | ne |
| `media-storage-failed`, `media-record-failed` | úložiště nebo databáze (i nahrání delší než 15 s) | ano, celkem 3× |
| `media-decoder-unavailable` | na serveru se nenačetl dekodér obrázků (sharp nebo jeho knihovna libvips); o obrázku to nic neříká | ano, celkem 3× |
| `media-lease-lost` | zámek kandidáta vypršel dřív, než průchod skončil; jen ve výsledku volání | ano, další volání |
| `media-page-*` | totéž pro stránku článku | podle chyby, celkem 3× |

Testy: `tests/lib/marketing-dneskai-media*.test.ts`. Síť v nich nahrazuje vložený
fetcher a resolver, databázi PGlite se skutečnými migracemi. Žádný test nevolá
Instagram ani placené API.

## Richer evidence in the prepared continuation

RSS prefers `content:encoded`. The article page already fetched for its pictures also yields up to 4,000 sanitized characters of article/main prose; scripts, navigation and instruction-shaped content are excluded. Image alt text/figure captions are retained as untrusted publisher metadata (up to 1,000 characters), never as a vision observation. The collection lease fences this evidence before the image plan is fixed. Brief `/2` carries these fields into the bounded offer; `/1` stays readable. Caption-only social evidence cannot become article or video-transcript evidence.

This requires the new, **unapplied** richer-evidence and brief-compatibility migrations listed in [migration-guide.md](migration-guide.md). Apply them through [migration-guide.md](migration-guide.md#applying-the-prepared-migrations). The owner settled agency credits on 22 October 2026 (decision 21); the rule is in [Credit](#credit) above.

## Reels: slideshow video (#163)

`renderDneskaiReel` in `src/lib/marketing/dneskai-reel-render.ts` turns a post's approved 1080 × 1350 slide JPEGs
into one 1080 × 1920 MP4 that Instagram accepts as a Reel. sharp builds one still per slide: the slide at 1016 px
wide, centred over a blurred, darkened copy of itself that fills the frame. ffmpeg then zooms each still from 1.00
to 1.06 over its 3.5 s (`zoompan`; at full zoom 1019 px of width stay visible, so the slide's edges are never cut),
joins them with 0.5 s crossfades (`xfade`) and encodes H.264 High, yuv420p, 30 fps, a closed 60-frame GOP at about
8 Mbps, AAC 128 kbps 48 kHz stereo, `+faststart`. A track shorter than the video loops; every track is cut at the
video's end with a 2 s fade-out. Without a track the MP4 carries a silent stereo track, for the trending-audio
path (C5) where Instagram lays its own audio over the video. A deck of n slides lasts `3n + 0.5` seconds.

`dneskaiReelForRevision` (`dneskai-reel.ts`) takes the slides of a revision's clean render from the render-key
cache in `marketing-assets`, keys the reel by the revision's content hash and the audio track (or `silent`) under
`DNESKAI_REEL_POLICY`, and renders only when no MP4 with that key is stored. The route
`POST /api/marketing/dneskai/render-reel` (body `{ revisionId }`) runs it for the owner or for a signed scheduler
or publisher call.

### Where it runs: Vercel, not Fly.io

Checked on 22 October 2026 through the Vercel API (read only): team `lukas-kourils-projects` is on the **Pro**
plan, project `own-dashboard` has **Fluid Compute on** with a default function timeout of 300 s. Pro with Fluid
allows `maxDuration` up to 800 s, so the route's 300 s fits. A function may be 250 MB uncompressed; the ffmpeg
binary (ffmpeg 6.1.1, release `b6.1.1`) is 79.8 MB on Linux x64 (43.5 MB on macOS) and is the only large file the route adds.

Measured locally on an Apple M2 with the real ffmpeg-static 5.3.0 build: a 7-slide reel (21.5 s, silent) took
25.3 s with one ffmpeg thread and 26.4 s with ffmpeg's default, and came to 20.5 MB. The filter graph (zoom and
crossfade) runs on one core, so a Vercel function with one vCPU should take one to three times as long, well inside
300 s. Decision: the renderer stays in the Vercel route; the Fly.io fallback from the plan is not built. If a real
render on Vercel ever comes close to the limit, the route's `RENDER_BUDGET_MS` (280 s) stops ffmpeg with
`reel-timeout` and the Fly.io port can be added behind the same `dneskaiReelForRevision` dependency.

### Storage

The plan named the public `marketing-media` bucket. That bucket is private and its restrictive policies refuse
anonymous reads, because it holds the downloaded source pictures. Reels therefore get their own private bucket,
`marketing-reels` (migration `20261023130000`, MP4 only, 64 MiB), with the same owner-prefix read and browser-write
guards as `marketing-assets`. Instagram receives a seven-day signed URL, which its cURL fetch reads like the signed
slide URLs it already fetches. Each object is written once (`upsert: false`) under
`<owner>/marketing/dneskai/reels/<reelKey>.mp4` and checked (size, type, owner, key, sha256) before it is signed.

### Codes

`reel-revision-unavailable` (404), `reel-revision-not-deck`, `reel-render-required`, `reel-input-invalid` (409),
`reel-slides-unavailable`, `reel-audio-unavailable`, `reel-storage-failed`, `reel-bucket-required`,
`reel-ffmpeg-unavailable` (503), `reel-compose-failed`, `reel-encode-failed` (500), `reel-timeout` (504). ffmpeg's
own error text goes to the function log only (`dneskai-reel-ffmpeg-failed`, last 800 characters).

Tests: `tests/lib/dneskai-reel-render.test.ts` renders a 2-slide fixture with and without a looped track and checks
it with ffprobe (container, codecs, 1080 × 1920, 30 fps, duration within 0.2 s, `moov` before `mdat`); CI installs
ffprobe. `tests/lib/dneskai-reel.test.ts` covers the cache, the refusals, storage and the route;
`tests/lib/dneskai-reel-bucket.test.ts` replays the bucket migration in PGlite.

## Reels: audio library (#164)

Zdroje → Hudba holds the tracks a Reel may play (`marketing_audio_tracks`, migration `20261023130100`, files in the
private `marketing-audio` bucket). The owner uploads a file with its title, artist, source, the page it came from, a
licence note and up to five mood tags; each track has a switch for the rotation and a 10-second preview. The Lab's
post card has a "Hudba Reelu" select: one enabled track or the rotation. The choice is saved as
`revision.audio.trackId`, so it is part of the content hash and approval binds the exact track. A post without a
choice takes the next enabled track after the previous Reel's (`nextDneskaiAudioTrack`), so two consecutive posts
never share a track while two or more are enabled. A carousel ignores the field.

### Licences and what the owner records

| Source | Why it is allowed | Record for each track |
|---|---|---|
| Meta Sound Collection (`meta-sound-collection`) | Meta's own library, cleared for use on Facebook and Instagram | The track's page in the collection, and the licence note "Meta Sound Collection" with the download date |
| Pixabay Music (`pixabay`) | The Pixabay Content License allows use in videos on social media without attribution | The track's Pixabay page and "Pixabay Content License" with the download date |
| Own recording (`original`) | Made by the owner | Where and when it was made |
| Instagram library (`instagram-library`) | Licensed by Instagram itself; usable only through the Facebook Login audio API (C4, C5) | The Instagram audio id; no file. Not offered for upload yet |

No commercial songs, and nothing from another source: a baked-in commercial song gets the Reel muted or blocked
(plan, section 2). The source URL is required for every uploaded file, so the origin of each track can be checked
later.

### Upload path

`POST /api/marketing/dneskai/audio` with `prepare` returns a signed upload URL for exactly
`<owner>/<new id>.<ext>`; the browser uploads the file there, then `create` downloads it, measures it with the same
ffmpeg as the renderer (audio stream, 1 s to 15 min, at most 20 MiB) and records the row. A file that fails is
deleted. `toggle` switches a track. The route and both screens are hidden while `MARKETING_DNESKAI_REELS_ENABLED`
is off. The render route (`/api/marketing/dneskai/render-reel`) bakes the approved track into the MP4 and keys the
reel by it.

## Manual music on carousels (#168)

Instagram's API puts music only on Reels, and licensed music only under Facebook Login (plan, section 2). Until
@dneskai moves to Facebook Login (#166), Příspěvky shows **Přidat hudbu v aplikaci** on every carousel published in the
last seven days: how to add music in the Instagram app (open the post, ⋯ → Upravit, add music, about 30 seconds) and
a suggested track name from the library with a copy button, a different enabled track per post. When the trending
ranking of #167 exists it can supply the name instead. The badge needs no API call and appears only while
`MARKETING_DNESKAI_REELS_ENABLED=true`, because the suggestion comes from the library. Code:
`src/components/marketing/dneskai/music-hint.tsx`.

## Trending sounds (#167)

Under Facebook Login (#166) Meta's Audio API answers `GET /ig_audio?audio_type=music|original_sound&user_id=<ig id>`
without a search query with the sounds trending now that @dneskai may use. With `DNESKAI_AUDIO_TRENDS_ENABLED=true`
the daily tick reads both types (at most 25 each) and records them in `marketing_audio_trends`: title, artist, type,
length, cover, first and last day trending and the number of days. Zdroje → Hudba shows them as "Trendy zvuky" and the
Lab picker offers them above the library.

A post with a trending sound stores `revision.audio = { instagramAudioId }`, so approval binds that exact sound. Its
Reel renders silent; the publisher sends `audio_configuration={"audio_id":…,"audio_volume":100}` on the REELS
container and Instagram lays the sound over it (Meta accepts volumes 1 to 100, so `video_volume` is left out; the
video has no sound). Under Instagram Login such a post holds before any request
(`trending-audio-facebook-login-required`). A sound Instagram refuses for the account or region ends as
`trending-audio-unavailable` with nothing created; the owner picks a library track and approves again. An automatic
re-render with a library track is not built: it would publish a sound the owner did not approve.

Not built yet: the niche ranking (scouting does not store reels' `musicInfo` yet) and the TikTok Creative Center CZ
signal (a paid Apify run that needs its own budget line). Their columns (`niche_count`, `tiktok`) exist and the screens
already show them when set.
