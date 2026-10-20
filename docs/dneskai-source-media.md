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

Dokud není zapojený plánovač (#120), sběr médií nic nevolá. Totéž platí pro načítání
bytů (#117, #118) a retenci: funkce existují, ale žádná cesta v aplikaci je zatím
nespouští.

Které kandidáty předat, řekne `pendingDneskaiMediaCandidates(db, owner, project)`:
vybrané kandidáty pro dnešní nebo pozdější pražský den, jejichž stahování nezačalo nebo
ještě není hotové, nejvýše osm. Plánovač volá sběr, dokud seznam není prázdný.

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

**Instagram:** všechny `mediaUrls` kandidáta v pořadí sběru (nejprve hlavní obrázek,
pak děti carouselu), nejvýše deset. Jen z hostů `cdninstagram.com` a `fbcdn.net`.
`displayUrl` a první položka `images[]` bývají stejný obrázek: stejné byty se uloží
jednou a druhá pozice dostane kód `media-duplicate-bytes`.

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
Neznámý host se přeskočí jako `media-host-not-publisher`, nehádá se. Vynechávají se
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
8 MiB a 15 s na obrázek (3 MB na stránku), přesměrování jen v povolených hostech.

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

Credit není nikdy prázdný a má nejvýše 120 znaků, stejně jako pole `credit` slidu.

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
| `media-host-not-publisher` | host není vydavatel ani jeho CDN | ne |
| `media-http-403`, `-404`, `-410` | odkaz vypršel nebo neexistuje | ne |
| `media-http-429`, `-5xx`, `media-timeout`, `media-fetch-failed` | přechodná chyba | ano, celkem 3× |
| `media-too-large`, `media-undecodable`, `media-host-unsafe`, `media-redirect-refused` | soubor nebo adresa nevyhovuje | ne |
| `media-storage-failed`, `media-record-failed` | úložiště nebo databáze (i nahrání delší než 15 s) | ano, celkem 3× |
| `media-lease-lost` | zámek kandidáta vypršel dřív, než průchod skončil; jen ve výsledku volání | ano, další volání |
| `media-page-*` | totéž pro stránku článku | podle chyby, celkem 3× |

Testy: `tests/lib/marketing-dneskai-media*.test.ts`. Síť v nich nahrazuje vložený
fetcher a resolver, databázi PGlite se skutečnými migracemi. Žádný test nevolá
Instagram ani placené API.
