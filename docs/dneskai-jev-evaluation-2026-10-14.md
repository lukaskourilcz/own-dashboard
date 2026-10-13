# Jev: ověření výběru 14. října 2026

Oprava je připravená lokálně. Nebyla nasazena a nemění přepínače sběru ani publikování.

## Co se změnilo

Jev dříve zadržoval vhodné zprávy, pokud si nebyl jistý přesnou kategorií.
Kategorie se však překrývají: jeden příspěvek může představovat AI novinku i AI projekt.
Nyní požadujeme alespoň 0,90 souhrnné pravděpodobnosti pro témata DNESKAi.
Samostatně zůstává práh relevance 0,85 a pravděpodobnosti rozhodnutí o duplicitě
0,90, s confidence alespoň 0,80. Nejasná duplicita vždy zůstává ke kontrole.
Souhrnné skóre je pravidlo aplikace, nikoli ověřená pravděpodobnost pravdivosti zprávy.

Otázka relevance zahrnuje konkrétní technologické události, financování,
bezpečnost a právní spory, užitečné nástroje, AI projekty a praktické marketingové rady.
Samotná pozvánka na akci nebo obecná propagace nestačí. Duplicitou je stejná
událost či tvrzení, nikoli pouze stejná firma nebo nástroj. Všechny odkazy na
položky a historii používají skutečné cesty ve vstupu. Historie je nadále omezená
na 148 záznamů; celý požadavek se kontroluje před placeným voláním.

Diagnostika odděluje zaměření, užitečnost a duplicitu. Kandidát dostává stručný
důvod zadržení s českým a anglickým překladem. Diagnostické skóre není součástí
veřejného kontraktu ani nového databázového sloupce. Oprava také toleruje již
povolený součet pravděpodobností 0,99/1,01 navzdory chybě desetinné reprezentace;
0,98/1,02, chybějící možnosti a nesprávný vítěz se stále odmítají.

Podklad: [TypeSafe primitives](https://docs.typesafe.ai/primitives),
[confidence](https://docs.typesafe.ai/confidence) a
[omezení Jev 1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md).
Model zůstává připnutý na `jev-1.13.0`.

## Skutečná data a výsledky

Použili jsme uložený produkční korpus 70 veřejných podkladů. Do devíti volání
vstoupilo 27 různých podkladů, část opakovaně kvůli porovnání. Žádný nový scraping.
Referenční hodnocení vytvořil agent před příslušným voláním; nejde o hodnocení
vlastníkem, nezávislé ověření tvrzení ani souhlas s publikací.

| Kontrola | Výsledek |
| --- | --- |
| Původní složený práh, 8 položek | 0 průchozích |
| První oprava, stejných 8 položek | 3 průchozí, 4 ke kontrole, 1 zamítnutá |
| Finální otázka, srovnávací sada 8 položek | 5 ze 6 vhodných průchozích; reklama a nedostatečný podklad zadrženy |
| Finální otázka, dosud nepoužitá sada 8 položek | 3 ze 4 vhodných průchozích; všechny 4 nedostatečné podklady zadrženy |
| Dvě kontrolní duplicity skutečných záznamů v historii | Obě označeny jako duplicita |
| Dvě různé verze Ollama | Ani jedna označena jako duplicita; jedna zadržena kvůli zaměření |
| Finální regresní sada 8 položek | 3 průchozí, 4 ke kontrole, 1 zamítnutá |

Kontrolní duplicity záměrně používají stejný skutečný záznam i v historii.
To ověřuje vazbu odpovědi na historii; není to důkaz úspěšnosti na různě
formulovaných zprávách z více zdrojů. Výsledky nejsou stabilní ve všech dávkách:
kratší historie a okolní položky mění některá hraniční skóre. Při této nejistotě
systém zadržuje výběr. Kategorie nejsou dostatečně spolehlivé jako přesná taxonomie.

Finální výsledky jsme vložili do oddělené místní databáze PGlite a spustili
skutečnou migrační funkci `marketing_dneskai_finish`. Při reprodukci času
původního sběru 13. října 20:30 UTC vybrala tři témata na 14. října:
Google Play a osobní AI, ovládání algoritmu Facebooku a využití AI proti střetům
s divokými zvířaty. Zachovala příznak `research-selection-not-fact-checked`.
Samostatný replay předchozí odpovědi navíc potvrdil, že čtvrtá tematicky vhodná,
ale starší zpráva vypadne na kontrole čerstvosti. Žádný záznam není schválený.
Jde o historickou reprodukci, nikoli nový obsah připravený pro dnešní publikaci.

## Cena a hranice ověření

Schváleno nejvýše 10 volání / 0,03 USD. Provedeno 9 volání, podle oznámených
vstupních tokenů a ověřené sazby celkem **0,00203343 USD**. Druhé volání vrátilo
HTTP 200, ale původní lokální validátor odmítl součet 0,99 kvůli zaokrouhlení.
Spotřeba byla doložena uloženou odpovědí; ta se po opravě přehrála místně bez
opakovaného placeného požadavku. Žádná spotřeba nezůstala neznámá.
Soukromé vstupy, odpovědi, předem určené štítky a účetní záznamy zůstaly mimo Git.

Nebyla měněna produkční data, n8n, tajemství ani přepínače. Nebyl vytvořen nový
scraping, deployment, návrh grafiky nebo publikace. Neprovedli jsme kontrolu
všech 70 podkladů finální verzí a netvrdíme stoprocentní přesnost či pokrytí.

## Před nasazením

Oprava nepotřebuje novou migraci ani klíče. Nasadit lze zdrojový commit s vypnutými
stávajícími přepínači. Dřívější produkční běh a jeho zadržené položky zůstávají
beze změny; nasazení samo je znovu nevyhodnotí. Případné nové placené ověření musí
mít vlastní vymezený rozsah. Staré rezervace, limity a běhy se neobnovují.
Denní plánování a publikování vyžadují samostatné rozhodnutí vlastníka.

## Technické kontroly

`npm run lint`, `npx tsc --noEmit` a `npm run build` prošly. Jednotkové testy
pokrývají překrývající se kategorie, oddělené důvody zadržení, součty
pravděpodobností, vazby duplicit, rozpočet vstupu, pracovní postup i SQL.
První úplný běh prošel: 1 396 testů, 1 přeskočený. Po posledním upřesnění
otázky prošlo 1 395 testů a 1 byl přeskočen; nesouvisející dynamický import
ve `changelog.test.ts` při souběžném sestavování překročil 5 sekund.
Samostatné opakování celého tohoto souboru prošlo všech 13 testů bez změny kódu.

Úplný běh prohlížečových testů: **125 prošlo, 70 přeskočeno, 1 selhal**.
Selhání je mimo Jev: test předplatného očekává relativní termín „in 8d“,
ale při běhu po pražské půlnoci dostal „in 7d“; datum splatnosti zůstalo stejné.
Pokus o izolované ověření s pevným časem skončil na navigaci do předplatného;
experiment byl odstraněn. Finální změna nezasahuje do předplatného ani tohoto testu.
Celá E2E sada tedy není zelená a tato známá chyba testovacího času zůstává před
release k vyřešení. Testy marketingu, Workflows a desktopové/mobilní přístupnosti
v úplném běhu prošly.
