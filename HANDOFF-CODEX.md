# Handoff pro Codex: OwnDashboard (`lukaskourilcz/own-dashboard`)

Stav k 9. 11. 2026, předává Claude. OwnDashboard obsahuje DNESKAi, devShark marketing, IG Kolekci, Backlog, Kalendář, Design Lab, Náměty a pipeline fotek bez holek pro HeyDarlink.

## Jak se tady pracuje

- **Nasazení:** produkce je Vercel, projekt `prj_SNP9bkzjoX7aICNCVxUoXAuqLE60`, team `team_Llq05zcu0iY4CYxEWNfq5w5i`. Merge do `main` nasadí automaticky, ručně jde `npx vercel redeploy <url> --target production`.
- **Databáze:** Supabase `gcctapykhrdyxikieemn`. Migrace jsou v `supabase/migrations/`, jejich verze musí sedět s produkční `schema_migrations`.
- **CI na GitHubu je vypnuté** (Lukáš 9. 11., workflow „CI“ id 290796638). Merge po lokálních kontrolách (typecheck, lint, dotčené testy), vždy `gh pr merge --merge`.
- **Trvalé svolení:** migrace, merge a nasazení bez ptaní (globální `~/.claude/CLAUDE.md`).
- **Backlog:** tabulka `public.backlog_items`. Stavy `open`, `ready_for_agent`, `in_progress`, `done`, `dropped`. Položky ve stavu `ready_for_agent` mají v `note` zadání od Lukáše. Při převzetí nastav `in_progress`, po dokončení `done` a výsledek dopiš do `note`.
- **Quorum už není potřeba:** renderer, kalendáře i zdroje DNESKAi jsou v own-dashboardu (#287, #299).

## Zapnuté přepínače a crony (Vercel produkce)

- **DNESKAi:**
  - `DNESKAI_ILLUSTRATIONS_ENABLED=true`: knihovna ilustrací z Pexels, cron `dneskai-illustrations-tick` každé 2 min, strop 2 $ za 24 h;
  - `DNESKAI_ILLUSTRATE_ENABLED=true`: plán kontroluje, jestli fotky sedí k tématu, a doplňuje je na každý slide;
  - `MARKETING_DNESKAI_DAILY_GENERATION_USD`: 5 $ do 13. 11. 00:00 pražského času (`_UNTIL`), pak automaticky 1 $.
- **Fotky bez holek pro HeyDarlink:**
  - `HEYDARLINK_AMBIENT_ENABLED=true`;
  - `HEYDARLINK_AMBIENT_REFILL=false`: automatické doplňování je vypnuté, dokud Lukáš neřekne jinak;
  - cron `heydarlink-ambient-tick` zpracovává jen inbox, tedy bucket `heydarlink-ambient-inbox`, složku `reviewed/` bez placené kontroly.
- **IG Kolekce:** `MARKETING_KNOWLEDGE_WORKER_ENABLED=true`, `APIFY_ACTOR_BUILD=0.0.632`, `MARKETING_CLAUDE_MODEL=claude-sonnet-5-5`, cena 2 a 10 $ za milion tokenů, neověřená proti ceníku Anthropicu.

## Otevřené úkoly

- **IG Kolekce (`/ig-collection`, #293):**
  - ještě neproběhlo žádné živé stažení ani shrnutí. První „Process queued“ je první skutečný test;
  - `apify/instagram-reel-scraper` může vracet foto a carousel příspěvky jako restricted;
  - 4 starší příspěvky nemají shrnutí (DZXWW-MyPNw, DbqYVjazc5Q, Dc_cSU9TbCD, Dcdixt5usK2), zpracují se po kliknutí na Re-process;
  - Lukáš musí nahrát export uložených příspěvků z Instagramu a vytvořit token pro sdílení (`docs/ig-kolekce.md`).
- **DNESKAi:**
  - knihovna ilustrací má zatím jen asi 45 velkých fotek. Lukáš generuje 100 dalších v Codexu podle `~/Documents/DNESKAi-ilustrace/dneskai-100-promptu.md`. Až je dodá, zkontroluj realismus a nahraj je do knihovny;
  - při opakovaném použití fotky se mění jen výřez a zoom. Barevný filtr a zrcadlení potřebují úpravu rendereru;
  - závěrečný slide je vypnutý (`marketing_dneskai_closing.enabled=false`), Lukáš ho zapne v Design Labu;
  - vlastní volba obálky přes kód slotu `cover-<sha256>[-<rrggbb>]` se musí nastavit mimo běh cronu (minuty končící 0 nebo 5), jinak ji cron přepíše;
  - barvy DNESKAi v editoru Design Labu nejsou hotové.
- **devShark:**
  - nejsilnější příspěvky na středu a pátek nejsou hotové, nemají ještě značku (otázka v backlogu);
  - Facebook stránku devShark založí Lukáš nebo agent v Chromu, Facebook dovolí jednu stránku denně. Stránka DNESKAi existuje: https://www.facebook.com/profile.php?id=61596426058395. Propojit ji s IG DNESKAi.
- **Odpovědi na komentáře:**
  - pořadí migrací ověřit podle backlogu (#272);
  - Threads potřebuje token s `threads_manage_replies`.
- **Testy:** `marketing-comment-inbox-database` padá i na `main`.
- **Lokální stav:** v `~/Developer/own-dashboard` je větev `devshark-studio` s 322 připravenými soubory, neznámého původu. Nesahat bez Lukáše.
- **Otevřené PR:** #226 je starý cizí PR, majitel ho má zkontrolovat.

## Klíče, které Lukáš může přidat

`PIXABAY_API_KEY` (další zdroj ilustrací), `GEMINI_API_KEY` (LDEV-415).
