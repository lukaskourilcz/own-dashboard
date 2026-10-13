import type { NavTab } from '@/lib/nav-tabs';

export const WORKFLOW_AREAS = {
  daily: ['home', 'work', 'tasks', 'calendar', 'goals', 'dates'],
  projects: ['projects', 'competition'],
  clients: ['opportunities', 'clients', 'career'],
  finance: ['invoices', 'money', 'accounts', 'transactions', 'subscriptions', 'categories'],
  knowledge: ['notes', 'prompts', 'tools', 'links', 'ig-tips'],
  marketing: ['marketing'],
  settings: ['settings'],
} as const satisfies Record<string, readonly NavTab[]>;

type Area = { title: string; purpose: string; input: string; owner: string; automatic: string; result: string };
type Flow = { title: string; steps: string[]; note: string };
type Strings = {
  title: string; description: string; verified: string; map: string; areasTitle: string;
  works: string; pilot: string; setup: string; input: string; owner: string; automatic: string; result: string;
  areas: Record<keyof typeof WORKFLOW_AREAS, Area>; mapFlows: Flow[]; marketingTitle: string;
  marketingIntro: string; marketingFlows: Flow[]; marketingHold: string; weekly: string;
  next: string; nextDescription: string; details: string;
};

export const workflows: { en: Strings; cs: Strings } = {
  en: {
    title: 'Workflows', description: 'Where to start, what connects, and which decisions are yours.',
    verified: 'Implementation reviewed on 13 October 2026. This is a guide, not a live status monitor.',
    map: 'How the areas connect', areasTitle: 'Choose an area', works: 'Available', pilot: 'Pilot / in progress', setup: 'Needs setup',
    input: 'Input', owner: 'Your step', automatic: 'What the app does', result: 'Result',
    mapFlows: [
      { title: 'Client work', steps: ['Opportunity', 'You convert it to a project', 'Project and client', 'You prepare an invoice'], note: 'Conversion creates the linked project and organization. Preparing and sending an invoice are separate owner actions.' },
      { title: 'Daily work', steps: ['Tasks and calendar', 'Daily focus on Home', 'Weekly planning in Work'], note: 'Home selects up to seven open tasks. You complete tasks and record next week’s objectives in Work.' },
      { title: 'Marketing', steps: ['Valid public source', 'Draft and graphics in the pilot', 'Your exact approval', 'Scheduled publishing: disabled'], note: 'Reviewed IG TIPS can guide presentation. Source approval and template approval do not approve a post.' },
    ],
    areas: {
      daily: { title: 'Daily work and planning', purpose: 'Choose today’s work and keep deadlines visible.', input: 'Your tasks, goals, deadlines and connected Google calendars.', owner: 'Complete tasks, maintain dates and finish the weekly review in Work.', automatic: 'Home selects daily focus tasks; the weekly review summarizes selected calendar time when Google is connected.', result: 'A daily list and saved objectives for the next week.' },
      projects: { title: 'Projects and competition', purpose: 'Keep delivery, costs and research with the project they belong to.', input: 'Your projects, linked repositories, tasks, notes, communications and competitor records.', owner: 'Open a project workspace, record progress and review older competition research.', automatic: 'The workspace groups related records and shows recorded costs and explained health warnings.', result: 'One project context, with your own products separated from freelance work.' },
      clients: { title: 'Opportunities, clients and Career', purpose: 'Follow client leads and job applications through your next decision.', input: 'Tugedr, direct and referral opportunities; job-board listings; your organizations and applications.', owner: 'Check for new offers, review them and decide whether to convert a lead or submit an application.', automatic: 'A confirmed conversion creates the linked project and organization. Offer checks run when you press the button.', result: 'Linked client work or an application history. Draft replies still need you to send them.' },
      finance: { title: 'Invoices and money', purpose: 'Prepare Czech invoices and track spend across projects.', input: 'Client details, invoice items, payments, accounts and subscription renewal dates.', owner: 'Check invoice and VAT details, issue or send the invoice, and maintain payments and renewals.', automatic: 'The app calculates totals, QR payment details and project allocations using its fixed exchange-rate table.', result: 'Invoice documents and comparable project costs. Bank records depend on your configured connection or import.' },
      knowledge: { title: 'Knowledge, links and IG TIPS', purpose: 'Keep useful material and connect it to the work that uses it.', input: 'Your notes, prompts, tools, links and captured Instagram tips.', owner: 'Add context, link material to projects and review presentation advice before marketing uses it.', automatic: 'The library groups records and can enrich a submitted URL. Saved capture alone does not start paid analysis.', result: 'Reusable notes and reviewed format advice. Recent Instagram Saved acquisition is deferred to a later session.' },
      marketing: { title: 'Marketing for devShark and DNESKAi', purpose: 'Review exact drafts and track their planned publication.', input: 'Valid devShark questions or active coding tasks; genuinely reviewed DNESKAi articles; approved templates and advice.', owner: 'Review the final text, graphics, account and time for each post. Return, skip or approve its exact version.', automatic: 'The isolated pilot checks sources and records job health. Scheduled preparation, publishing and analytics still need completion and setup.', result: 'A review queue and publication receipts when publishing is enabled. A successful copy step alone is not a finished carousel.' },
      settings: { title: 'Settings and integrations', purpose: 'Control language, theme, visible sections and connections.', input: 'Your preferences and the integrations you choose to connect.', owner: 'Connect the required service, select calendars and review access before changing permissions.', automatic: 'The app saves preferences and reports configured integration state.', result: 'The same workspace in your chosen language and theme. Missing connections remain visible as setup work.' },
    },
    marketingTitle: 'From source to a reviewed post',
    marketingIntro: 'The steps below describe the implemented pilot and its intended handoffs. Production publishing and scheduled workflows are disabled.',
    marketingFlows: [
      { title: 'DNESKAi: daily news', steps: ['BoardlessAI produces the article', 'Owner selects the final headline and image', 'Current source and evidence check', 'Social draft'], note: 'BoardlessAI remains the article producer. Fourteen real article reviews are held. Preview selection does not authorize magazine delivery; there is no eligible final article source yet.' },
      { title: 'devShark: Sunday preparation', steps: ['Effective question or active public coding task', 'Current eligibility check', 'Prepare the next seven days', 'Owner reviews each exact post'], note: 'The requested daily plan is one Instagram feed post, two Threads posts and three Stories. Weekly batching is in progress; later dates stay in the backlog.' },
      { title: 'Shared preparation and approval', steps: ['Reviewed knowledge advice', 'Claude / LangChain copy and Humanizer', 'Approved Claude Design layout and renderer', 'Final preview in Marketing'], note: 'Knowledge guides format and process. It cannot replace source evidence. LangSmith helps investigate failures with redacted traces.' },
      { title: 'After approval', steps: ['Wait for the approved slot', 'Recheck source, account and exact version', 'Meta publishing: disabled', 'Receipt and weekly evaluation'], note: 'n8n coordinates HTTP steps. Publishing requires separate enablement; Instagram analytics needs additional consented access and Threads needs its own connection.' },
    ],
    marketingHold: 'Current hold: the paid pilot has used its three admitted jobs without a final stored revision. Further paid generation needs a verified render fix and a new owner-approved allowance.',
    weekly: 'Evaluate the preceding week before the next Sunday plan. Recent metrics may be incomplete; missing data does not mean zero engagement. Early results guide small experiments, not claims of a winning format.',
    next: 'What to do next', nextDescription: 'Use Marketing to inspect draft health and approval decisions. Use Settings for connections. This page does not start a workflow or make a decision.', details: 'Verification and remaining work',
  },
  cs: {
    title: 'Workflows', description: 'Kde začít, co na sebe navazuje a které kroky čekají na vás.',
    verified: 'Implementaci jsme ověřili 13. října 2026. Toto je průvodce, nikoli živý přehled stavu.',
    map: 'Jak spolu oblasti souvisejí', areasTitle: 'Vyberte oblast', works: 'Funguje', pilot: 'Pilot / rozpracováno', setup: 'Čeká na nastavení',
    input: 'Vstup', owner: 'Váš krok', automatic: 'Co dělá aplikace', result: 'Výsledek',
    mapFlows: [
      { title: 'Práce pro klienta', steps: ['Příležitost', 'Vy ji převedete na projekt', 'Projekt a klient', 'Vy připravíte fakturu'], note: 'Převod vytvoří propojený projekt a organizaci. Přípravu a odeslání faktury potvrdíte zvlášť.' },
      { title: 'Denní práce', steps: ['Úkoly a kalendář', 'Denní výběr na Domů', 'Týdenní plánování v Přehledu práce'], note: 'Domů vybere nejvýše sedm otevřených úkolů. Vy dokončujete úkoly a v Přehledu práce zapisujete cíle na další týden.' },
      { title: 'Marketing', steps: ['Platný veřejný podklad', 'Návrh a grafika v pilotu', 'Vaše schválení přesné verze', 'Plánované publikování: vypnuté'], note: 'Zkontrolované IG TIPS mohou poradit s formátem. Schválení podkladu ani šablony neschvaluje příspěvek.' },
    ],
    areas: {
      daily: { title: 'Denní práce a plánování', purpose: 'Vyberte dnešní práci a hlídejte termíny.', input: 'Vaše úkoly, cíle, termíny a připojené Google kalendáře.', owner: 'Dokončujte úkoly, udržujte termíny a dokončete týdenní revizi v Přehledu práce.', automatic: 'Domů vybere denní úkoly; týdenní revize shrne čas z vybraných kalendářů, pokud máte připojený Google.', result: 'Denní seznam a uložené cíle na další týden.' },
      projects: { title: 'Projekty a konkurence', purpose: 'Držte práci, náklady a průzkum u příslušného projektu.', input: 'Vaše projekty, propojené repozitáře, úkoly, poznámky, komunikace a záznamy o konkurenci.', owner: 'Otevřete projekt, zapište postup a zkontrolujte starší průzkum konkurence.', automatic: 'Projektový pohled seskupí související záznamy a ukáže evidované náklady a vysvětlená upozornění.', result: 'Jeden kontext projektu, s vlastními produkty oddělenými od práce pro klienty.' },
      clients: { title: 'Příležitosti, klienti a Kariéra', purpose: 'Sledujte nabídky klientů a pracovní přihlášky až k dalšímu rozhodnutí.', input: 'Příležitosti z Tugedru, přímého oslovení a doporučení; pracovní nabídky; vaše organizace a přihlášky.', owner: 'Zkontrolujte nové nabídky a rozhodněte o převodu příležitosti nebo odeslání přihlášky.', automatic: 'Potvrzený převod vytvoří propojený projekt a organizaci. Nové nabídky aplikace kontroluje po stisku tlačítka.', result: 'Propojená práce pro klienta nebo historie přihlášek. Připravené odpovědi stále odesíláte vy.' },
      finance: { title: 'Faktury a peníze', purpose: 'Připravte české faktury a sledujte výdaje projektů.', input: 'Údaje klienta, položky faktur, platby, účty a data obnovy předplatných.', owner: 'Zkontrolujte fakturu a DPH, vystavte či odešlete ji a udržujte platby a obnovy.', automatic: 'Aplikace spočítá součty, platební QR a rozdělení nákladů podle své pevné kurzové tabulky.', result: 'Faktury a srovnatelné náklady projektů. Bankovní záznamy závisejí na vašem připojení nebo importu.' },
      knowledge: { title: 'Znalosti, odkazy a IG TIPS', purpose: 'Uložte užitečné podklady a propojte je s prací, která je potřebuje.', input: 'Vaše poznámky, prompty, nástroje, odkazy a zachycené instagramové tipy.', owner: 'Doplňte kontext, propojte podklady s projekty a před použitím v marketingu zkontrolujte rady k formátu.', automatic: 'Knihovna seskupí záznamy a může doplnit vložený odkaz. Samotné zachycení Saved nespouští placenou analýzu.', result: 'Použitelné poznámky a zkontrolované rady. Získání posledních Instagram Saved jsme odložili na další session.' },
      marketing: { title: 'Marketing pro devShark a DNESKAi', purpose: 'Zkontrolujte přesné návrhy a sledujte jejich plánované zveřejnění.', input: 'Platné otázky devSharku nebo aktivní coding tasky; skutečně zkontrolované články DNESKAi; schválené šablony a rady.', owner: 'U každého příspěvku zkontrolujte finální text, grafiku, účet a čas. Přesnou verzi vraťte, vynechte nebo schvalte.', automatic: 'Izolovaný pilot kontroluje zdroje a zapisuje stav přípravy. Plánovaná příprava, publikování a analytika ještě čekají na dokončení a nastavení.', result: 'Fronta ke schválení a potvrzení po povoleném zveřejnění. Úspěšný krok přípravy textu sám neznamená hotový carousel.' },
      settings: { title: 'Nastavení a integrace', purpose: 'Upravte jazyk, vzhled, viditelné sekce a připojení.', input: 'Vaše preference a služby, které se rozhodnete připojit.', owner: 'Připojte potřebnou službu, vyberte kalendáře a před změnou oprávnění zkontrolujte přístup.', automatic: 'Aplikace uloží preference a ukáže stav nastavených integrací.', result: 'Stejný pracovní prostor ve zvoleném jazyce a vzhledu. Chybějící připojení zůstávají viditelná jako potřebné nastavení.' },
    },
    marketingTitle: 'Od podkladu ke zkontrolovanému příspěvku',
    marketingIntro: 'Následující kroky popisují implementovaný pilot a zamýšlené návaznosti. Produkční publikování a plánované workflows jsou vypnuté.',
    marketingFlows: [
      { title: 'DNESKAi: denní zprávy', steps: ['BoardlessAI připraví článek', 'Majitel vybere finální titulek a obrázek', 'Kontrola aktuálního zdroje a důkazů', 'Návrh social příspěvku'], note: 'Články dál připravuje BoardlessAI. Čtrnáct skutečných článků čeká na kontrolu. Výběr v Preview nepovoluje vydání magazínu; zatím nemáme platný finální článek pro social přípravu.' },
      { title: 'devShark: nedělní příprava', steps: ['Platná otázka nebo aktivní veřejný coding task', 'Kontrola aktuální platnosti', 'Příprava příštích sedmi dnů', 'Majitel zkontroluje každý přesný příspěvek'], note: 'Požadovaný denní plán je jeden příspěvek do Instagram feedu, dva příspěvky na Threads a tři Stories. Týdenní přípravu dokončujeme; vzdálenější termíny zůstávají v backlogu.' },
      { title: 'Společná příprava a schválení', steps: ['Zkontrolované rady z knihovny', 'Text přes Claude / LangChain a Humanizer', 'Schválené rozvržení z Claude Design a renderer', 'Finální náhled v Marketingu'], note: 'Znalosti radí s formátem a postupem. Nenahrazují důkazy o zdroji. LangSmith pomáhá dohledat chyby z redigovaných záznamů.' },
      { title: 'Po schválení', steps: ['Čekání na schválený termín', 'Kontrola zdroje, účtu a přesné verze', 'Publikování přes Meta: vypnuté', 'Potvrzení a týdenní vyhodnocení'], note: 'n8n řídí HTTP kroky. Publikování vyžaduje samostatné povolení; instagramová analytika další schválený přístup a Threads vlastní připojení.' },
    ],
    marketingHold: 'Aktuální blokace: placený pilot vyčerpal tři přijaté přípravy bez finální uložené verze. Další placená příprava potřebuje ověřenou opravu renderování a nový limit schválený majitelem.',
    weekly: 'Před dalším nedělním plánem vyhodnoťte předchozí týden. Nedávná data mohou být neúplná; chybějící údaj neznamená nulový zájem. První výsledky slouží k malým experimentům, ne k tvrzení o vítězném formátu.',
    next: 'Další krok', nextDescription: 'V Marketingu zkontrolujte stav návrhů a schválení. Připojení řešte v Nastavení. Tato stránka workflow nespouští ani nedělá rozhodnutí.', details: 'Ověření a zbývající práce',
  },
};
