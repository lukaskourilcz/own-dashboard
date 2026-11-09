# IG Kolekce

IG Kolekce drží příspěvky, které sis uložil na Instagramu: nápady na obsah a tipy. Sekce je v menu vedle IG TIPS (ikona záložky). Každý příspěvek se stáhne a shrne, ale jen když to spustíš tlačítkem. Nic se neimportuje dvakrát a záhlaví ukazuje, kam až sahá poslední import.

Pravidlo z [Saved sources and atomic knowledge](marketing-knowledge.md) platí dál: žádné cookies Instagramu, žádné přihlášení za tebe, žádné URL soukromých uložených kolekcí. Aplikace bere jen tvůj vlastní export a veřejné URL příspěvků.

## 1. Export z Instagramu

1. V aplikaci Instagram otevři Profil → menu (tři čárky) → Centrum účtů → Vaše informace a oprávnění → Exportovat vaše informace.
2. Zvol Vytvořit export → svůj profil → Exportovat do zařízení.
3. U Upravit informace nech jen **Uložené** (Saved). Formát nastav na **JSON**, ne HTML. Období vyber od data v záhlaví IG Kolekce („Importováno do …“), poprvé „Za celou dobu“.
4. Instagram pošle e-mail, až je export hotový (obvykle do několika hodin). Stáhni ZIP a rozbal ho.
5. Ve složce `your_instagram_activity/saved/` najdeš `saved_posts.json` (uvnitř klíč `saved_saved_media`) a `saved_collections.json` (klíč `saved_saved_collections`). Starší exporty mají složku `saved/` přímo v kořeni. Na jménu souboru nezáleží, aplikace pozná soubor podle obsahu.
6. V IG Kolekci klikni na **Importovat export (JSON)** a vyber oba soubory najednou. Soubor kolekcí přidá k příspěvkům názvy tvých kolekcí jako štítky.

Po importu uvidíš souhrn, například „Nově importováno: 12 příspěvků. 400 přeskočeno: už v IG Kolekci. 3 přeskočeno: už v IG TIPS/Odkazech.“

### Co se považuje za známý příspěvek

Příspěvek se pozná podle shortcode (část URL za `/p/` nebo `/reel/`), zvlášť pro každého vlastníka. Za známý se bere, když:

- už je v IG Kolekci, nebo
- ho jmenuje některý tvůj záznam v IG TIPS nebo v Odkazech (`url` nebo `source_urls`).

Příspěvek z IG TIPS se shrnutím se v kolekci ukáže jako hotový se štítkem „Už v IG TIPS“ a s tímhle shrnutím. Stahovat se nebude. Příspěvek z IG TIPS bez shrnutí je taky hotový; stáhne se, jen když u něj klikneš na **Zpracovat znovu**. Migrace takhle při nasazení převezme všechny příspěvky, které už v IG TIPS a Odkazech jsou.

### High-water mark

Aplikace si pamatuje nejnovější datum uložení z importovaných exportů. Záhlaví ho ukazuje jako „Importováno do …“. Příští export si vyžádej od tohoto data; starší příspěvky by se stejně přeskočily. Příspěvky přidané ručně nebo přes zkratku tohle datum neposouvají, aby dál odpovídalo exportu.

Datum uložení z exportu se ukládá jako neověřené (stejně jako v [marketing-knowledge.md](marketing-knowledge.md)).

## 2. Jednotlivé příspěvky

**Přidat URL**: vlož jednu nebo víc URL příspěvků nebo Reels, každou kamkoli do textu. Aplikace vezme jen veřejné URL tvaru `instagram.com/p/…`, `/reel/…`, `/reels/…`, `/tv/…`. Odkazy na profily a uložené kolekce odmítne.

### Zkratka pro sdílení (iPhone)

1. V IG Kolekci klikni v kartě Sdílení z Instagramu na **Vytvořit token pro sdílení**. Token se zobrazí jen jednou, hned si ho zkopíruj. Dashboard si nechává jen jeho hash (SHA-256). **Vyměnit token** vytvoří nový a starý okamžitě přestane platit. **Vypnout sdílení** token smaže.
2. Na iPhonu otevři aplikaci Zkratky → **+** → nová zkratka.
3. Klepni na **(i)** a zapni **Zobrazit v listu sdílení**. Jako typy vstupu nech **URL** a **Text**.
4. Přidej akci **Získat obsah URL** a nastav:
   - URL: adresa z karty („URL pro zkratku“), tedy `https://<tvůj dashboard>/api/marketing/knowledge/share`
   - Metoda: **POST**
   - Hlavičky: `Authorization` = `Bearer <token>`
   - Tělo požadavku: **JSON**, klíč `url` (text) = **Vstup zkratky**
5. Volitelně přidej **Zobrazit oznámení** s výsledkem akce. Odpověď je `{"status":"added"}`, `"already-in-collection"` nebo `"already-in-tips"`.
6. Pojmenuj zkratku, třeba „Do IG Kolekce“.
7. V Instagramu klepni u příspěvku na ikonu sdílení → **Sdílet do…** (nebo **Další**) → „Do IG Kolekce“.

Endpoint jen uloží příspěvek do fronty. Nikdy nespouští stahování ani model. Bez platného tokenu odpoví 401.

## 3. Co se děje po importu

Nic placeného. Import, Přidat URL i zkratka příspěvek jen uloží a zařadí jako **Ve frontě**. Automatické zpracování neexistuje.

Zpracování spouštíš ručně:

- **Zpracovat frontu** zpracuje až 20 nejnovějších příspěvků ve frontě.
- **Zpracovat znovu** u jednoho příspěvku (hotového, selhaného nebo nepřístupného) ho vrátí do fronty a zpracuje.

Obojí nejdřív ukáže dialog s počtem příspěvků a maximální cenou. Běh začne, až zaškrtneš souhlas a klikneš na Spustit.

Jeden příspěvek projde těmito stavy:

1. **Ve frontě** — čeká na tvoje spuštění.
2. **Stahuje se** — Apify (`apify/instagram-reel-scraper` s připnutým buildem `APIFY_ACTOR_BUILD`) stáhne veřejný příspěvek: popisek, přepis řeči, náhled, autora a datum zveřejnění.
3. **Shrnuje se** — Claude (model `MARKETING_CLAUDE_MODEL`, strukturovaný výstup) napíše shrnutí na 2–3 věty, tipy, štítky a návrh projektu (DNESKAi, devShark, heyDarlink, osobní). Postupy s doslovnými citacemi z popisku nebo přepisu jdou do IG TIPS jako nápady ke kontrole; postupy bez citace aplikace zahodí.
4. **Hotovo**, **Nepřístupný** (soukromý nebo smazaný příspěvek) nebo **Selhalo** (s důvodem na kartě).

Claude dostane jen popisek (max. 2 500 znaků) a přepis (max. 5 000 znaků) toho jednoho příspěvku. Žádné tvoje poznámky, projekty ani přihlašovací údaje. Selhaný běh se sám nikdy neopakuje.

Bez `MARKETING_KNOWLEDGE_WORKER_ENABLED=true`, `APIFY_TOKEN`, `APIFY_ACTOR_BUILD` a nastavení Clauda (`ANTHROPIC_API_KEY`, `MARKETING_CLAUDE_MODEL`, ceny za token) zůstane příspěvek ve frontě a nic se neutratí.

## 4. Ceny

- Strop na jeden příspěvek je **0,05 $** (Apify + Claude). Server ho hlídá sám.
- Apify má na běh strop 0,02 $ (`maxTotalChargeUsd`, `maxItems=1`). Skutečná cena jednoho Reelu je kolem 0,005 $.
- Claude dostane zbytek do 0,05 $. Před voláním server odhadne cenu z velikosti vstupu a 1 200 výstupních tokenů; když by přesáhla zbytek, Clauda nezavolá a příspěvek označí jako selhaný. Po volání zkontroluje skutečnou spotřebu.
- Apify platí jen z předplaceného kreditu, nikdy z karty. Před každým příspěvkem server přečte `/v2/users/me/limits` a `/v2/users/me`. Když zbývá méně než 0,02 $ do měsíčního limitu nebo do kreditu z plánu, příspěvek zůstane ve frontě a běh skončí („Předplacený kredit Apify je vyčerpaný“).
- Jedno kliknutí na Zpracovat frontu tak stojí nejvýš 20 × 0,05 $ = 1 $.

## Technicky

- Data: řádky `marketing_knowledge_sources` (sloupce `author`, `collections`, `media`, `digest`, `collection_status`, `collection_error`, `processed_at`, `ai_link_id`) a `marketing_collection_settings` (hash tokenu, high-water mark, poslední import a běh). Migrace `20261109120000_ig_collection.sql`. RLS: vlastník čte jen svoje řádky, hash tokenu nečte vůbec; zápisy jdou přes service-role funkce.
- API: `GET/POST /api/marketing/collection` (přihlášený vlastník, kontrola původu, limit 40/min) a `POST /api/marketing/knowledge/share` (bearer token).
- Kód: `src/lib/marketing/ig-collection.ts` (parser exportu, filtry), `ig-collection-runner.ts` (Apify a Claude), `src/components/panels/ig-collection-panel.tsx`.
