# Stylová příručka DNESKAi

Platí pro každý text, který DNESKAi generuje: texty slidů, popisky na Instagramu a příspěvky na Threads. Vychází z rozboru pěti článků CzechCrunch (cc.cz) z 8. listopadu 2026. Pět redaktorů psalo o AI, technologii, startupech a byznysu, v delším textu i v krátké zprávě. Z článků se nic nepřebírá; příklady níže jsou vlastní parafráze.

Generátor dostává tato pravidla v `DNESKAI_STYLE_RULES` (`src/lib/marketing/dneskai-generation.ts`). Pravidla vlastníka v `.claude/skills/dneskai-post-content/SKILL.md` mají přednost.

## Tón

- Klidný novinářský tón s lehce hovorovým okrajem. Občas napiš „prý“, „pro představu“ nebo „jde o to, že“, slang ale ne.
- Text nehodnotí. Ironie a překvapení vznikají postavením faktů vedle sebe, ne přídavnými jmény.
  - Místo „neuvěřitelný úspěch“ napiš „Firma plánovala 250 tisíc kusů ročně. Loni prodala 20 tisíc.“
- Žádné vykřičníky, superlativy, „revoluce“, „game changer“ ani „šokující“.
- Silný výrok patří jmenovanému aktérovi, ne redakci: „Podle Mety…“, „OpenAI tvrdí, že…“.

## Titulek a první slide

- Titulek má dvě části:
  1. Konkrétní, lidský nebo překvapivý háček.
  2. Za tečkou věcná zpráva s aktérem a číslem.
- Vzor: „Startup psalo pět lidí. Teď ho Meta kupuje pro své AI programování.“
- První slide nese jen titulek. Fakt je stejně silný jako ve zdroji, nikdy ne otázka nebo teaser, který zamlčí, o co jde.

## Úvod popisku

- První věta řekne, co se stalo, kdo to udělal a o kolik jde. Nejvýš 125 znaků.
- Druhá věta řekne, proč to čtenáře zajímá: co to mění pro něj, pro firmy nebo pro trh.
- Kontext a pozadí přicházejí až po háčku. Úvod se nezahlcuje čísly.

## Věty a rytmus

- Většina vět má 12–20 slov. Po delší vysvětlující větě přijde krátká, která bod usadí („Čísla mluví jasně.“, „Jenže.“).
- Na slidu jedna myšlenka. Žádná souvětí se třemi vedlejšími větami.
- Mezi delší věty dávej krátké přechody: „Pro představu:“, „Proč?“ Otázka se ale nesmí objevit v titulku ani na prvním slidu.

## Dávkování informací

Pořadí: událost, rozsah v číslech, kdo za tím stojí, souvislost, důsledek, co bude dál.

- Velká čísla převeď na něco hmatatelného: dolary orientačně na koruny v závorce (jen když je kurz ve zdroji), výkon na domácnosti, data na stránky.
- Jména a čísla přicházejí postupně, nejvýš dvě nová čísla na jeden slide.
- Odstavec nebo slide končí konkrétním faktem, důsledkem nebo dalším krokem, ne obecnou frází. Poslední odstavec popisku může nechat otevřenou otázku jako oznamovací větu: „Jestli to vydrží, je otázkou.“

## Technika pro běžného čtenáře

- Odborný pojem pojmenuj a hned vysvětli přístavkem s „tedy“ nebo vedlejší větou: „infostealer, tedy program, který z počítače tiše vysává hesla“.
- Popisuj, co technologie dělá pro uživatele, ne jak je naprogramovaná.
- Abstraktní věc ukotvi příkladem ze života: „třeba objednávka, kterou Alexa sama zopakuje“.
- Zažité anglicismy (startup, AI, API, chatbot, cloud) se nepřekládají. Méně známé se vysvětlí.

## Přechody a obraty

Používej:

- kontrast: „Jenže“, „Přitom“, „Na jednu stranu… na druhou“, „Zatímco“;
- dodání souvislosti: „Navíc“, „Ostatně“, „Mezitím“;
- důsledek: „Proto“, „Za tři roky se tak…“;
- obrat ke kritice: „Má to ale i stinnou stránku.“;
- atribuci: „podle firmy“, „tvrdí“, „uvádí“, „odhaduje“, u nejisté věci „prý“.

## Čemu se vyhnout

- Vykřičníkům, emoji, hype slovníku, řečnickým otázkám v titulku, oslovování čtenáře („Víte, že…?“).
- Morálním soudům a vlastním odhadům. Kritiku nesou fakta a jmenovaní aktéři.
- Nevysvětlenému žargonu a nadměrnému vysvětlování toho, co čtenář zná.
- Řeči o zdrojích a ověřování (pravidlo vlastníka). Zdroje se do příspěvku nepíšou, ani na slidy, ani do popisku. Případně je přidáme jako komentář.
- Kopírování formulací ze zdrojových článků.

## Threads

- Jeden odstavec, nejvýš 500 znaků:
  1. háček;
  2. fakt s číslem;
  3. proč na tom záleží.
- Bez hashtagů v textu. Téma jde jako `topic_tag` (FioBanka, OpenAI).
- Tón je stejný jako v popisku, jen sevřenější.

## Příklad (parafráze, smyšlené zadání)

- **Titulek:** „Píše za vás kód na pozadí. OpenAI ukázala asistenta dots.“
- **Popisek:**
  > OpenAI představila dots, asistenta, který pracuje na úkolech, i když máte okno zavřené.
  >
  > Jde o to, že nemusíte čekat na odpověď. Zadáte práci a vrátíte se k hotovému výsledku. Zatím je to pro vybrané uživatele v USA.
  >
  > Přitom podobnou funkci chystají i Google a Anthropic. Kdo ji dotáhne do běžného používání, je otázkou.
