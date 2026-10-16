/** Public-source research only. Personal letters live in owner-only Supabase
 * rows, never in this public repository. Dates are observations, not promises
 * that an employer will keep a vacancy open. */
export const OSLO_RESEARCHED_ON = "2026-10-16";
export const STRONG_OSLO_MATCH = 75;
export type Localized = { cs: string; en: string };
export type ResearchJob = {
  id: string;
  company: string;
  title: string;
  url: string;
  aliases: string[];
  source: "LinkedIn" | "The Hub" | "Employer" | "FINN";
  location: string;
  arrangement: string;
  stack: string[];
  /** Stack /40, experience /25, domain /15, location /10, language /10. */
  points: [number, number, number, number, number];
  summary: Localized;
  evidence: Localized;
  gaps: Localized;
  stretch?: boolean;
  blocker?: boolean;
  salary?: string;
  deadline?: string;
  postedLabel?: string;
  linkedinSaved?: boolean;
  needsRecheck?: boolean;
};
const l = (cs: string, en: string): Localized => ({ cs, en });
const li = (id: string) => `https://www.linkedin.com/jobs/view/${id}/`;
const hub = (id: string) => `https://thehub.io/jobs/${id}`;

export const OSLO_JOBS: ResearchJob[] = [
  {
    id: "aidn-fullstack-mid",
    company: "Aidn",
    title: "Fullstack Engineer",
    url: "https://aidn.teamtailor.com/jobs/8485371-fullstack-engineer",
    aliases: [],
    source: "Employer",
    location: "Oslo / anywhere in Norway",
    arrangement: "Hybrid · Full-time",
    stack: ["React", "Next.js", "TypeScript", "PostgreSQL", "C#/.NET"],
    points: [34, 22, 12, 10, 10],
    salary: "850,000–980,000 NOK/year",
    summary: l(
      "Vývoj zdravotnického SaaS od návrhu po provoz. Vedle seniorní role je otevřena i tato úroveň.",
      "End-to-end healthcare SaaS engineering, open alongside the senior position.",
    ),
    evidence: l(
      "React/Next.js, PostgreSQL, zkušenost s greenfield rezervačním produktem a odpovědnost za celé funkce.",
      "React/Next.js, PostgreSQL, a greenfield reservation product and end-to-end feature ownership.",
    ),
    gaps: l(
      "C#/.NET je nová část stacku, ale firma výslovně přijímá zkušenost se sousedními technologiemi. Sjednotit přihlášku se seniorní nabídkou.",
      "C#/.NET is a learning area, but adjacent technologies are explicitly accepted. Coordinate with the senior application.",
    ),
  },
  {
    id: "enode-home-energy",
    company: "Enode",
    title: "Senior Software Engineer (Home Energy)",
    url: "https://jobs.ashbyhq.com/Enode/83a3de6b-5f7c-4bcd-a374-ed55025af38d",
    aliases: [],
    source: "Employer",
    location: "Remote Europe / Oslo office",
    arrangement: "Remote · Full-time",
    stack: ["Node.js", "TypeScript", "APIs", "PostgreSQL", "AWS", "AI tools"],
    points: [37, 16, 13, 9, 10],
    stretch: true,
    summary: l(
      "Integrace a API propojující baterie, solární panely, HVAC a měřiče. Aktivní přímá nabídka zveřejněná v červenci.",
      "Integrations and APIs for batteries, solar, HVAC and meters. Active direct-employer vacancy originally published in July.",
    ),
    evidence: l(
      "Bankovní API/BFF, Node/TypeScript, Controlant IoT incidenty a práce s AI nástroji jsou přímé přenositelné důkazy.",
      "Banking APIs/BFF, Node/TypeScript, Controlant IoT incidents and AI tooling provide relevant evidence.",
    ),
    gaps: l(
      "Větší backendová odpovědnost a AWS jsou posun. Ověřit zaměstnávání z Norska; na LinkedIn se starý inzerát neukládal.",
      "Substantial backend ownership and AWS are growth areas. Confirm Norway employment; no older LinkedIn listing was saved.",
    ),
  },
  {
    id: "spond-software",
    company: "Spond",
    title: "Software Engineer",
    url: "https://careers.spond.com/jobs/7708251-software-engineer",
    aliases: [],
    source: "Employer",
    location: "Oslo",
    arrangement: "Hybrid · Full-time",
    stack: ["React", "TypeScript", "Java", "Go", "APIs", "Payments"],
    points: [24, 13, 11, 10, 10],
    stretch: true,
    summary: l(
      "Backendově orientovaný produktový vývoj pro sportovní týmy, platby a komunikaci.",
      "Backend-oriented product development for sports teams, payments and communications.",
    ),
    evidence: l(
      "React/TypeScript, návrh API, rezervace a bankovní doména mají dobrý přesah.",
      "React/TypeScript, API design, bookings and banking experience transfer well.",
    ),
    gaps: l(
      "Java/Go a škálování zatížených microservices nejsou doložené. Angličtina stačí, norština je pouze výhodou.",
      "Java/Go and high-load microservice scaling are not documented. English is essential; Norwegian is optional.",
    ),
  },
  {
    id: "dnv-fis",
    company: "DNV",
    title: "FIS Developer and Architect",
    url: "https://jobs.dnv.com/job-search/maritime/it-and-software/oslo-norway/fis-developer-and-architect/300001704858406",
    aliases: [],
    source: "Employer",
    location: "Høvik / Oslo",
    arrangement: "Full-time · Permanent",
    stack: ["React", "TypeScript", "C#/.NET", "GraphQL", "MS SQL", "AI"],
    points: [25, 10, 8, 10, 10],
    stretch: true,
    summary: l(
      "Digitální námořní služby v organizaci s rozsáhlou .NET platformou a AI integracemi.",
      "Digital maritime services on a substantial .NET platform with AI integrations.",
    ),
    evidence: l(
      "React/TypeScript, API kontrakty, testy a praktické LLM integrace.",
      "React/TypeScript, API contracts, tests and practical LLM integration.",
    ),
    gaps: l(
      "4 roky produkčního Microsoft stacku nejsou doložené. Základní znalost C# nestačí k pokrytí architektonického rozsahu.",
      "Four years of production Microsoft-stack work is not documented. C# familiarity does not cover the architectural scope.",
    ),
  },
  {
    id: "monil-embedded",
    company: "Monil",
    title: "Senior Embedded Software Engineer",
    url: "https://careers.monil.com/jobs/7885199-senior-embedded-software-engineer",
    aliases: [hub("6a3c705e0ddf507f87b1a084")],
    source: "Employer",
    location: "Lysaker / Oslo area",
    arrangement: "On-site · Full-time",
    stack: ["C/C++", "Firmware", "GNSS", "Low-power devices"],
    points: [3, 3, 7, 10, 10],
    blocker: true,
    deadline: "2026-08-16",
    needsRecheck: true,
    summary: l(
      "Firmware pro virtuální oplocení a senzory. Stránka je dostupná, ale uvedený termín již uplynul.",
      "Firmware for virtual fencing and sensors. The page is live but its stated deadline has passed.",
    ),
    evidence: l(
      "Controlant poskytuje kontext IoT provozu, nikoli zkušenost s embedded vývojem.",
      "Controlant provides IoT operations context rather than embedded engineering experience.",
    ),
    gaps: l(
      "5+ let embedded C/C++, nízká spotřeba a komunikační protokoly nejsou doložené. Neprioritizovat; termín 16. srpna 2026.",
      "5+ embedded C/C++ years, low-power design and communication protocols are not documented. Do not prioritize; deadline August 16, 2026.",
    ),
  },
  {
    id: "six-open-senior",
    company: "Six Robotics",
    title: "Open Application · Senior Software Engineering",
    url: "https://careers.sixrobotics.com/jobs/6075415-open-application-senior-software-engineering-roles",
    aliases: [hub("692643d1efed440a42eeb0a4")],
    source: "Employer",
    location: "Oslo",
    arrangement: "Open application · Full-time",
    stack: ["Python", "Rust", "C++", "Distributed systems"],
    points: [10, 9, 7, 10, 10],
    stretch: true,
    summary: l(
      "Obecná seniorní přihláška pro budoucí potřeby, nikoli konkrétní otevřené frontendové místo.",
      "Senior talent-pool application for future needs, rather than a specific frontend vacancy.",
    ),
    evidence: l(
      "Samostatná produktová práce, API a komplexní UI mohou být zajímavé pro jiný tým.",
      "Independent product work, APIs and complex UI may interest another team.",
    ),
    gaps: l(
      "5+ let a Python/Rust/C++ jsou mezery. Nutná prověrka; kariérní homepage navíc uvádí občanství NATO. U EU občanství nelze automaticky předpokládat splnění.",
      "5+ years and Python/Rust/C++ are gaps. Clearance is required; the careers homepage also specifies NATO citizenship. EU citizenship alone does not establish eligibility.",
    ),
  },
  {
    id: "six-open-junior",
    company: "Six Robotics",
    title: "Open Application · Junior Engineers & Students",
    url: "https://careers.sixrobotics.com/jobs/6643602-open-application-junior-engineers-students",
    aliases: [],
    source: "Employer",
    location: "Oslo",
    arrangement: "Open application · Junior / internship",
    stack: ["Software engineering", "Robotics", "Personal projects"],
    points: [16, 17, 6, 10, 10],
    summary: l(
      "Talent pool pro juniorní a studentské příležitosti. Není garantováno aktuální místo.",
      "Talent pool for junior and student opportunities, without a guaranteed current vacancy.",
    ),
    evidence: l(
      "DevShark a další vlastní projekty mohou ukázat schopnost samostatného vývoje.",
      "DevShark and personal projects can demonstrate independent engineering.",
    ),
    gaps: l(
      "Není to konkrétní full-time nabídka. Ověřit vhodnost pro nestudenta a podmínky bezpečnostní prověrky; vhodnější první volba je frontend role.",
      "Not a specific full-time vacancy. Check suitability for a non-student and clearance conditions; the frontend opening is the stronger first choice.",
    ),
  },
  {
    id: "flowcase-frontend",
    company: "Flowcase",
    title: "Senior Frontend Engineer",
    url: hub("6ac43a7bdc5cdd6a8ef8db4f"),
    aliases: [
      "https://flowcase.teamtailor.com/jobs/8454300-senior-frontend-engineer",
      li("4474611780"),
      "https://www.finn.no/job/ad/478014108",
    ],
    source: "The Hub",
    location: "Oslo",
    arrangement: "Hybrid · 2+ office days/week",
    stack: ["React", "TypeScript", "React Query", "Accessibility", "i18n"],
    points: [39, 18, 11, 10, 10],
    salary: "900,000–1,200,000 NOK/year",
    postedLabel: "LinkedIn: 1 week ago",
    linkedinSaved: true,
    summary: l(
      "SaaS pro nabídky, životopisy a případové studie. Důraz na rychlé, přístupné rozhraní a spolupráci s designem.",
      "Proposal SaaS with a focus on fast, accessible interfaces and close design collaboration.",
    ),
    evidence: l(
      "React/TypeScript, WCAG z bankovnictví, API kontrakty a práce s opakovaně použitelnými komponentami.",
      "React/TypeScript, banking WCAG work, API contracts and reusable components.",
    ),
    gaps: l(
      "Požaduje bydliště v Norsku: uvést příjezd 22. října a občanství EU. React Aria a Vanilla Extract nejsou doložené.",
      "Requires Norway residence: state the October 22 move and EU citizenship. React Aria and Vanilla Extract are not documented.",
    ),
  },
  {
    id: "attensi-creator",
    company: "Attensi",
    title: "Frontend Developer – Creator Tools",
    url: hub("6a20c0e10b3b2add892bf4e1"),
    aliases: [
      li("4475304278"),
      "https://careers.attensi.com/jobs/7838295-frontend-developer-creator-tools",
    ],
    source: "The Hub",
    location: "Oslo",
    arrangement: "On-site · Full-time",
    stack: [
      "TypeScript",
      "SvelteKit",
      "Tailwind CSS",
      "SignalR",
      "AI",
      "C#/.NET",
    ],
    points: [33, 20, 15, 10, 10],
    postedLabel: "LinkedIn: 1 week ago",
    linkedinSaved: true,
    summary: l(
      "Interaktivní webový nástroj pro tvorbu tréninkových her, spolupráci v reálném čase a AI tvorbu obsahu.",
      "Interactive authoring tools for training games, real-time collaboration and AI-assisted content.",
    ),
    evidence: l(
      "DevShark je osobní vzdělávací produkt; silný TypeScript, Tailwind, WebSockets/Ably a zkušenost s ElevenLabs.",
      "DevShark provides a personal learning-product connection; TypeScript, Tailwind, WebSockets/Ably and ElevenLabs are relevant.",
    ),
    gaps: l(
      "React je přenositelný, ale SvelteKit a SignalR jsou nová část stacku. C#/.NET uvádět jako základní znalost a chuť se učit.",
      "React transfers well, but SvelteKit and SignalR are learning areas. Describe C#/.NET as familiarity, not deep experience.",
    ),
  },
  {
    id: "pexip-control",
    company: "Pexip",
    title: "Software Engineer · Control Center",
    url: li("4473222575"),
    aliases: [],
    source: "LinkedIn",
    location: "Oslo",
    arrangement: "On-site · Full-time",
    stack: ["React", "TypeScript", "APIs", "Testing", "Accessibility"],
    points: [39, 18, 11, 10, 10],
    postedLabel: "2 weeks ago",
    linkedinSaved: true,
    summary: l(
      "Frontend řídicího centra pro video infrastrukturu: produktové rozhraní, integrace API a kvalita komponent.",
      "Frontend for a video infrastructure control center, combining product UI, API integration and component quality.",
    ),
    evidence: l(
      "Produkční React/TypeScript, přístupnost, testy a zkušenost s komplexním internetovým bankovnictvím.",
      "Production React/TypeScript, accessibility, tests and complex banking interfaces.",
    ),
    gaps: l(
      "Inzerát míří na 3+ roky. Doložené vývojářské pozice začínají v roce 2024; starší freelance ukázat konkrétně.",
      "Targets 3+ years. Documented engineering roles start in 2024; support earlier freelance work with concrete examples.",
    ),
  },
  {
    id: "aize-iam",
    company: "Aize",
    title: "Senior Software Engineer – IAM",
    url: li("4472917306"),
    aliases: [
      li("4471539686"),
      "https://careers.aize.io/jobs/8466722-senior-software-engineer-iam",
    ],
    source: "LinkedIn",
    location: "Oslo",
    arrangement: "Hybrid · Full-time",
    stack: ["React", "TypeScript", "IAM", "APIs", "CI/CD", "C#/.NET"],
    points: [36, 18, 10, 10, 10],
    postedLabel: "2 weeks ago",
    linkedinSaved: true,
    summary: l(
      "Frontend identity a přístupu v průmyslovém digitálním produktu, se zapojením do API a infrastruktury.",
      "Identity and access interfaces for an industrial digital product, with API and infrastructure collaboration.",
    ),
    evidence: l(
      "React/TypeScript, autentizace, bankovní BFF/API a odpovědnost za kvalitu produktu.",
      "React/TypeScript, authentication, banking BFF/API work and product quality ownership.",
    ),
    gaps: l(
      "Hloubka IAM, Terraform a produkční C# nejsou doložené. Připravit příklad bezpečného návrhu oprávnění.",
      "Deep IAM, Terraform and production C# are not documented. Prepare a concrete authorization design example.",
    ),
  },
  {
    id: "no-isolation-ai",
    company: "No Isolation",
    title: "AI Integration Engineer",
    url: hub("6a7bb9536cd84825d6ab518f"),
    aliases: [],
    source: "The Hub",
    location: "Oslo",
    arrangement: "Full-time",
    stack: ["n8n", "APIs", "Webhooks", "SQL", "LLM integrations", "Windmill"],
    points: [37, 18, 11, 10, 10],
    summary: l(
      "Automatizace interních procesů, propojení podnikových systémů a praktické zavádění AI.",
      "Internal workflow automation, business-system integrations and practical AI adoption.",
    ),
    evidence: l(
      "Silná zkušenost s n8n, LangChain, Apify a TypeSafe AI (Jev); Ersilia: analýza PDF pomocí LLM a automatizace přes GitHub API.",
      "Strong n8n, LangChain, Apify and TypeSafe AI (Jev) experience; Ersilia LLM PDF analysis and GitHub API automation.",
    ),
    gaps: l(
      "Ověřit očekávanou hloubku RAG/evaluací, self-hostingu, Windmill a Odoo. Nepopisovat integraci modelů jako jejich trénování.",
      "Clarify production RAG/evaluation, self-hosting, Windmill and Odoo expectations. Model integration is not model training.",
    ),
  },
  {
    id: "aidn-fullstack",
    company: "Aidn",
    title: "Senior Fullstack Engineer",
    url: li("4472805772"),
    aliases: [
      "https://aidn.teamtailor.com/jobs/8484435-senior-fullstack-engineer",
    ],
    source: "LinkedIn",
    location: "Oslo / Norway",
    arrangement: "Hybrid · Full-time",
    stack: ["React", "Next.js", "TypeScript", "PostgreSQL", "C#/.NET"],
    points: [34, 18, 12, 10, 10],
    salary: "1,000,000–1,200,000 NOK/year",
    postedLabel: "2 weeks ago",
    linkedinSaved: true,
    summary: l(
      "Vývoj zdravotnického produktu napříč frontendem a backendem; firma připouští zkušenost se sousedním stackem.",
      "Healthcare product engineering across frontend and backend; adjacent-stack experience is explicitly welcome.",
    ),
    evidence: l(
      "React/Next.js, PostgreSQL, produktové integrace a provozní zkušenost s citlivými cold-chain systémy v Controlantu.",
      "React/Next.js, PostgreSQL, product integration and operational experience with cold-chain systems at Controlant.",
    ),
    gaps: l(
      "C#/.NET je rozvojová oblast. Vyjasnit senioritu a míru samostatnosti při backendových změnách.",
      "C#/.NET is a growth area. Clarify the expected seniority and independence in backend changes.",
    ),
  },
  {
    id: "sanity-agent",
    company: "Sanity",
    title: "Senior Software Engineer, Content Agent",
    url: "https://www.sanity.io/careers/senior-software-engineer-content-agent",
    aliases: [
      "https://jobs.ashbyhq.com/sanity/52fc85b3-fa35-48ec-ae43-63f8e7d22ac7",
    ],
    source: "Employer",
    location: "Oslo",
    arrangement: "Hybrid · 2–3 office days/week",
    stack: ["TypeScript", "React", "AI agents", "LLMs", "APIs"],
    points: [37, 17, 12, 10, 10],
    stretch: true,
    summary: l(
      "Produktové AI nástroje pro práci s obsahem, orchestrace agentů a rozhraní pro jejich používání.",
      "AI-powered content tools, agent orchestration and the interfaces people use to control them.",
    ),
    evidence: l(
      "TypeScript/React, LangChain a praktické AI integrace; Ersilia propojuje LLM s analýzou dokumentů.",
      "TypeScript/React, LangChain and practical AI integration; Ersilia connected LLMs with document analysis.",
    ),
    gaps: l(
      "Seniorní produkční agenti, MCP a systematické evaluace vyžadují konkrétní důkazy. Starý LinkedIn repost nebyl uložen.",
      "Senior production-agent, MCP and evaluation experience needs concrete evidence. An older LinkedIn result was not saved.",
    ),
  },
  {
    id: "flex-product",
    company: "The Flex / Base360.ai",
    title: "Senior Full-Stack Product Engineer",
    url: li("4470937040"),
    aliases: [],
    source: "LinkedIn",
    location: "Norway · Remote",
    arrangement: "Remote · Full-time",
    stack: [
      "React",
      "TypeScript",
      "Supabase",
      "PostgreSQL",
      "AI agents",
      "Python/FastAPI",
    ],
    points: [35, 17, 14, 10, 10],
    stretch: true,
    postedLabel: "3 weeks ago",
    linkedinSaved: true,
    summary: l(
      "Produkt pro pronájem nemovitostí a automatizaci provozu, s AI a integracemi plateb i komunikace.",
      "Rental operations product with AI, payment and communications integrations.",
    ),
    evidence: l(
      "Rezervační platformy, React/TypeScript, Supabase/PostgreSQL a znalost automatizačních nástrojů.",
      "Reservation products, React/TypeScript, Supabase/PostgreSQL and automation tooling.",
    ),
    gaps: l(
      "Python/FastAPI, AWS a konkrétní integrace Stripe/Twilio nejsou doložené. Ověřit možnost práce zaměstnance z Norska.",
      "Python/FastAPI, AWS and specific Stripe/Twilio integrations are not documented. Confirm Norway employment arrangements.",
    ),
  },
  {
    id: "euronext-lead",
    company: "Euronext Securities Oslo",
    title: "Digital Transformation & User Experience Tech Lead",
    url: "https://www.finn.no/job/ad/476126469",
    aliases: [li("4464318714")],
    source: "FINN",
    location: "Oslo / Porto",
    arrangement: "Full-time · English",
    stack: ["React", "Node.js", "BFF", "REST APIs", "Docker", "CI/CD"],
    points: [39, 12, 14, 10, 10],
    stretch: true,
    summary: l(
      "Vedení frontendové strategie, sdílených knihoven a BFF/API pro interní finanční platformu.",
      "Frontend strategy, shared libraries and BFF/API ownership for a financial backoffice platform.",
    ),
    evidence: l(
      "Velmi přímá shoda s bankovním BFF, API kontrakty, Reactem a vedením vývoje rezervační platformy.",
      "Direct overlap with banking BFF work, API contracts, React and reservation-platform development leadership.",
    ),
    gaps: l(
      "Jde o výrazně seniornější vedení týmů a architektury. Doložit rozsah rozhodování a nezaměňovat vedení projektu za personální management.",
      "A substantial team and architecture leadership stretch. Evidence the decision scope without equating project leadership with people management.",
    ),
  },
  {
    id: "six-frontend",
    company: "Six Robotics",
    title: "Senior Frontend Engineer",
    url: "https://careers.sixrobotics.com/jobs/8222972-senior-frontend-engineer",
    aliases: [
      hub("6a7fad52036f96c311993c37"),
      li("4451246408"),
      "https://www.finn.no/job/ad/477281376",
    ],
    source: "Employer",
    location: "Oslo",
    arrangement: "On-site · Full-time",
    stack: ["React", "TypeScript", "Real-time", "Frontend architecture"],
    points: [38, 12, 9, 10, 10],
    stretch: true,
    summary: l(
      "Ovládací rozhraní autonomních UAV: reálná data, složité interakce, spolehlivost a výkon.",
      "Operator interfaces for autonomous UAVs, with real-time data, complex interactions and reliability requirements.",
    ),
    evidence: l(
      "Silný React/TypeScript, WebSockets/Ably, komplexní produktová rozhraní a samostatná odpovědnost.",
      "Strong React/TypeScript, WebSockets/Ably, complex product interfaces and independent ownership.",
    ),
    gaps: l(
      "5+ let není doloženo. Nutná způsobilost k bezpečnostní prověrce; občanství EU ji samo nepotvrzuje. LinkedIn uvádí repost, původní datum není ověřené: neuložen.",
      "5+ years is not documented. Security-clearance eligibility is required; EU citizenship does not establish it. LinkedIn only shows a repost date: not saved.",
    ),
  },
  {
    id: "halliburton-lead",
    company: "Halliburton",
    title: "Lead Frontend Software Engineer (React/TypeScript)",
    url: li("4478108925"),
    aliases: [],
    source: "LinkedIn",
    location: "Oslo",
    arrangement: "On-site · Full-time",
    stack: [
      "React",
      "TypeScript",
      "TanStack",
      "Data visualization",
      "Performance",
    ],
    points: [37, 12, 8, 10, 10],
    stretch: true,
    postedLabel: "2 days ago",
    linkedinSaved: true,
    summary: l(
      "Frontend vědeckých a datově náročných nástrojů Landmark, architektura a výkon složitých aplikací.",
      "Architecture and performance of data-intensive Landmark frontend applications.",
    ),
    evidence: l(
      "React/TypeScript, práce na rozsáhlém bankovním rozhraní, testy a technické vedení produktu.",
      "React/TypeScript, complex banking interfaces, tests and product development leadership.",
    ),
    gaps: l(
      "Lead seniorita a vědecká vizualizace jsou výrazný posun. D3/WebGL a pokročilé profilování nejsou doložené.",
      "Lead scope and scientific visualization are a stretch. D3/WebGL and advanced profiling are not documented.",
    ),
  },
  {
    id: "trg-lead",
    company: "Tenth Revolution Group",
    title: "Lead Front End Developer",
    url: li("4470834718"),
    aliases: [li("4470834708")],
    source: "LinkedIn",
    location: "Oslo",
    arrangement: "Hybrid · Full-time",
    stack: ["React", "TypeScript", "TanStack", "Frontend architecture"],
    points: [37, 11, 7, 10, 10],
    stretch: true,
    postedLabel: "2 weeks ago",
    linkedinSaved: true,
    salary: "800,000–1,200,000 NOK/year",
    summary: l(
      "Nábor pro klienta s náročným datovým frontendem a potřebou technického vedení.",
      "Agency recruitment for a client with a complex data frontend and technical leadership needs.",
    ),
    evidence: l(
      "React/TypeScript, API kontrakty, návrh komponent a vedení vývoje produktu.",
      "React/TypeScript, API contracts, component design and product development leadership.",
    ),
    gaps: l(
      "Klient není veřejně identifikován. Před podáním ověřit duplicitu s Halliburton a druhým inzerátem agentury.",
      "The client is not publicly identified. Check for overlap with Halliburton and the agency's second listing before applying.",
    ),
  },
  {
    id: "surplusmap-fullstack",
    company: "SurplusMap",
    title: "Senior Full Stack Engineer GIS / AI",
    url: hub("62a7d017bb0f0ff068a8b929"),
    aliases: [],
    source: "The Hub",
    location: "Oslo / Remote",
    arrangement: "Remote option · Full-time",
    stack: ["React", "TypeScript", "GCP", "GIS", "AI"],
    points: [34, 16, 6, 10, 10],
    stretch: true,
    summary: l(
      "Webové nástroje pro prostorová data a rozhodování v energetice a udržitelnosti.",
      "Web tools for geospatial data and decisions in energy and sustainability.",
    ),
    evidence: l(
      "React/TypeScript, GCP, datově orientované aplikace a integrace LLM.",
      "React/TypeScript, GCP, data-oriented applications and LLM integration.",
    ),
    gaps: l(
      "GIS, satelitní data a specializované ML nejsou doložené. Starší ID inzerátu neznamená čerstvé zveřejnění; ověřit aktuálnost před podáním.",
      "GIS, satellite data and specialized ML are not documented. An old listing ID does not establish recency; recheck before applying.",
    ),
    needsRecheck: true,
  },
  {
    id: "mercor-evaluation",
    company: "Mercor",
    title: "Frontend Code Evaluation Specialist",
    url: li("4477251120"),
    aliases: [],
    source: "LinkedIn",
    location: "Oslo / Remote",
    arrangement: "Part-time · Contract",
    stack: ["HTML", "CSS", "JavaScript", "Responsive UI", "Code review"],
    points: [39, 18, 8, 8, 10],
    postedLabel: "4 days ago",
    linkedinSaved: true,
    salary: "Advertised: USD 90/hour",
    summary: l(
      "Hodnocení frontendového kódu a kvality webových rozhraní pro AI. Alternativní kontrakt, ne hlavní dlouhodobá priorita.",
      "Frontend-code and interface evaluation for AI. An alternative contract rather than the primary long-term target.",
    ),
    evidence: l(
      "Silné základy HTML/CSS, responsive UI a každodenní práce s frontendovým kódem.",
      "Strong HTML/CSS, responsive UI and daily frontend engineering.",
    ),
    gaps: l(
      "Částečný kontrakt a proměnlivý objem práce. Ověřit délku projektu, sazbu a smluvní podmínky.",
      "Part-time contract with uncertain workload. Confirm project duration, rate and contract terms.",
    ),
  },
  {
    id: "kongsberg-fullstack",
    company: "Kongsberg Digital / Falkor Horizon",
    title: "Senior Fullstack Software Engineer",
    url: hub("6aa496b34fe964368a491535"),
    aliases: [
      "https://careers.falkor.com/jobs/8366923-senior-fullstack-software-engineer",
    ],
    source: "The Hub",
    location: "Oslo / Lysaker",
    arrangement: "Full-time",
    stack: ["Node.js", "TypeScript", "Angular", "PostgreSQL", "Redis", "Cloud"],
    points: [31, 11, 8, 10, 10],
    stretch: true,
    summary: l(
      "Vývoj průmyslové digitální platformy napříč API, databázemi a webovým frontendem.",
      "Industrial digital-platform engineering across APIs, data storage and frontend.",
    ),
    evidence: l(
      "Node.js/TypeScript, PostgreSQL, Redis, integrace API a bankovní systémy.",
      "Node.js/TypeScript, PostgreSQL, Redis, API integrations and banking systems.",
    ),
    gaps: l(
      "6+ let, preferovaný Angular a rozsáhlé distribuované systémy jsou mezery. Ověřit současný název zaměstnavatele při podání.",
      "6+ years, preferred Angular and large distributed systems are gaps. Confirm the employer's current name when applying.",
    ),
  },
  {
    id: "cognite-fullstack",
    company: "Cognite",
    title: "Senior Software Engineer – Fullstack",
    url: li("4478513510"),
    aliases: ["https://job-boards.eu.greenhouse.io/cognite/jobs/4971045101"],
    source: "LinkedIn",
    location: "Oslo",
    arrangement: "Hybrid · Full-time",
    stack: ["React", "TypeScript", "Python", "PostgreSQL", "GCP", "LangChain"],
    points: [29, 10, 8, 10, 10],
    stretch: true,
    postedLabel: "3 days ago",
    linkedinSaved: true,
    summary: l(
      "Fullstack produkt pro průmyslová data a AI, s významnou backendovou částí v Pythonu.",
      "Fullstack industrial-data and AI product with substantial Python backend work.",
    ),
    evidence: l(
      "React/TypeScript, GCP, PostgreSQL, LangChain a zkušenost s integrací datových API.",
      "React/TypeScript, GCP, PostgreSQL, LangChain and data API integrations.",
    ),
    gaps: l(
      "Požadovaných 6+ let a produkční Python/FastAPI/Django nejsou doložené. AI tooling sám tyto požadavky nenahrazuje.",
      "Required 6+ years and production Python/FastAPI/Django are not documented. AI tooling does not replace those requirements.",
    ),
  },
  {
    id: "trg-ai",
    company: "Tenth Revolution Group",
    title: "Legal Tech – AI Engineer",
    url: li("4473146589"),
    aliases: [],
    source: "LinkedIn",
    location: "Oslo",
    arrangement: "On-site · Full-time",
    stack: ["Python", "FastAPI", "React", "LangChain", "RAG", "Azure"],
    points: [29, 12, 9, 10, 10],
    stretch: true,
    postedLabel: "1 week ago",
    linkedinSaved: true,
    summary: l(
      "AI produkt pro právní práci, vyhledávání a práci s dokumenty; nábor přes agenturu.",
      "Legal AI product for retrieval and document workflows, recruited through an agency.",
    ),
    evidence: l(
      "LLM analýza PDF v Ersilia, LangChain, React a praktická automatizace.",
      "LLM PDF analysis at Ersilia, LangChain, React and practical automation.",
    ),
    gaps: l(
      "Python/FastAPI, pgvector/ArangoDB, Azure a měřené RAG evaluace nejsou potvrzené. Vyjasnit senioritu i klienta.",
      "Python/FastAPI, pgvector/ArangoDB, Azure and measured RAG evaluations are unconfirmed. Clarify the client and seniority.",
    ),
  },
  {
    id: "rentelligent-fullstack",
    company: "Rentelligent",
    title: "Full Stack Engineer",
    url: li("4477103621"),
    aliases: [],
    source: "LinkedIn",
    location: "Oslo",
    arrangement: "On-site · Full-time",
    stack: ["TypeScript", "Vue", "Perl", "Go", "APIs"],
    points: [25, 11, 9, 10, 8],
    stretch: true,
    postedLabel: "1 week ago",
    linkedinSaved: true,
    summary: l(
      "Produktové rozhraní a backend pro správu pronájmů a nemovitostí.",
      "Product interfaces and backend for property and rental management.",
    ),
    evidence: l(
      "TypeScript, produktový fullstack a doména rezervací mají přenositelné části.",
      "TypeScript, product fullstack and booking-domain experience transfer in part.",
    ),
    gaps: l(
      "Vue, Perl/Go a požadovaná délka zkušeností jsou významné mezery. Inzerát je norsky; vyjasnit pracovní jazyk.",
      "Vue, Perl/Go and tenure expectations are significant gaps. The ad is in Norwegian; clarify the working language.",
    ),
  },
  {
    id: "visoid-growth",
    company: "VISOID",
    title: "Growth Engineer",
    url: li("4473437475"),
    aliases: [],
    source: "LinkedIn",
    location: "Oslo",
    arrangement: "On-site · Full-time",
    stack: ["APIs", "Frontend", "Analytics", "Automation", "AI tools"],
    points: [30, 9, 7, 10, 10],
    stretch: true,
    blocker: true,
    postedLabel: "1 week ago",
    linkedinSaved: true,
    summary: l(
      "Vývoj experimentů, integrací a automatizací pro růst AI vizualizačního produktu.",
      "Experiments, integrations and automation for an AI visualization product.",
    ),
    evidence: l(
      "Frontend, cit pro design, API a n8n/LangChain/Apify/TypeSafe AI.",
      "Frontend, design awareness, APIs and n8n/LangChain/Apify/TypeSafe AI.",
    ),
    gaps: l(
      "Výslovně požadován minimálně BSc a 3 roky full-time. Titul není v CV doložen; před podáním ověřit výjimku.",
      "Explicit minimum BSc and 3 years full-time. A degree is not documented; ask whether equivalent experience is accepted.",
    ),
  },
  {
    id: "six-platform",
    company: "Six Robotics",
    title: "Senior Software Engineer – Developer Platform",
    url: "https://careers.sixrobotics.com/jobs/7935842-senior-software-engineer-developer-platform",
    aliases: [],
    source: "Employer",
    location: "Oslo",
    arrangement: "On-site · Full-time",
    stack: ["Python", "Docker", "GitHub Actions", "Developer tooling"],
    points: [23, 12, 7, 10, 10],
    stretch: true,
    summary: l(
      "Nástroje a infrastruktura pro efektivnější vývoj robotického softwaru.",
      "Developer tooling and infrastructure for robotics engineering.",
    ),
    evidence: l(
      "GitHub Actions, Docker, automatizace a zlepšování vývojových konvencí.",
      "GitHub Actions, Docker, automation and development conventions.",
    ),
    gaps: l(
      "Python, monorepo tooling a produkční DevEx jsou velký posun. Nutná způsobilost k bezpečnostní prověrce.",
      "Python, monorepo tooling and production DevEx are a substantial stretch. Security-clearance eligibility is required.",
    ),
  },
  {
    id: "no-isolation-backend",
    company: "No Isolation",
    title: "Senior Software Engineer",
    url: hub("693a0a28efed440a42857043"),
    aliases: [],
    source: "The Hub",
    location: "Oslo",
    arrangement: "Full-time",
    stack: ["Go", "WebRTC", "gRPC", "Kubernetes", "AWS"],
    points: [12, 10, 7, 10, 10],
    stretch: true,
    summary: l(
      "Backend a komunikace pro AV1, s výrazným důrazem na Go a infrastrukturu.",
      "AV1 backend and communications engineering with deep Go and infrastructure work.",
    ),
    evidence: l(
      "API, TypeScript fullstack a provozní řešení incidentů jsou přenositelné základy.",
      "API, TypeScript fullstack and operational incident work provide transferable foundations.",
    ),
    gaps: l(
      "Hluboké Go, WebRTC/gRPC, Kubernetes a požadované STEM vzdělání nejsou doložené. AI Integration je vhodnější role ve stejné firmě.",
      "Deep Go, WebRTC/gRPC, Kubernetes and the STEM education requirement are not documented. AI Integration is the stronger role at this employer.",
    ),
  },
  {
    id: "di-frontend",
    company: "Distribution Innovation",
    title: "Senior Frontend-utvikler",
    url: "https://www.finn.no/job/ad/478562551",
    aliases: [li("4477526812")],
    source: "FINN",
    location: "Oslo",
    arrangement: "Hybrid · Full-time",
    stack: ["React", "TypeScript", "Testing", "React Native"],
    points: [38, 10, 8, 10, 0],
    blocker: true,
    deadline: "2026-10-30",
    summary: l(
      "Webový frontend a design systém logistického produktu, částečně také mobilní aplikace.",
      "Web frontend and design system for logistics products, with some mobile applications.",
    ),
    evidence: l(
      "React/TypeScript, frontendové testy a provozní zkušenost s IoT logistikou.",
      "React/TypeScript, frontend tests and operational IoT logistics experience.",
    ),
    gaps: l(
      "Povinná dobrá norština a 5+ let. Norština není v CV; skóre omezeno na 49 % a role není prioritou.",
      "Good Norwegian and 5+ years are required. Norwegian is not in the CV; score capped at 49% and excluded from priorities.",
    ),
  },
  {
    id: "sopra-frontend",
    company: "Sopra Steria",
    title: "Senior Frontendutvikler",
    url: "https://www.finn.no/job/ad/478002325",
    aliases: [],
    source: "FINN",
    location: "Oslo",
    arrangement: "Hybrid · Full-time",
    stack: ["React", "TypeScript", "Next.js", "AI tools"],
    points: [37, 10, 8, 10, 0],
    blocker: true,
    deadline: "2026-11-08",
    summary: l(
      "Frontend a AI nástroje v klientských projektech poradenské společnosti.",
      "Frontend and AI tooling across consultancy client projects.",
    ),
    evidence: l(
      "React/TypeScript/Next.js, přístupnost a AI nástroje dobře odpovídají.",
      "React/TypeScript/Next.js, accessibility and AI tooling overlap well.",
    ),
    gaps: l(
      "Norština minimálně B2, 4+ roky a vzdělání. Některé projekty vyžadují prověrku.",
      "Norwegian B2 minimum, 4+ years and education expectations; some projects require clearance.",
    ),
  },
  {
    id: "nettbil-backend",
    company: "Nettbil",
    title: "Senior Software Engineer (Backend)",
    url: li("4477194266"),
    aliases: [],
    source: "LinkedIn",
    location: "Oslo",
    arrangement: "Full-time",
    stack: ["TypeScript", "Node.js", "PostgreSQL", "Vitest", "AWS"],
    points: [36, 9, 7, 10, 0],
    blocker: true,
    postedLabel: "1 week ago",
    summary: l(
      "Backend tržiště s auty, API a provozní infrastruktura.",
      "Backend APIs and operational infrastructure for a car marketplace.",
    ),
    evidence: l(
      "Node.js, TypeScript, PostgreSQL a Vitest jsou silná technická shoda.",
      "Node.js, TypeScript, PostgreSQL and Vitest are a strong technical overlap.",
    ),
    gaps: l(
      "Norština je pracovní jazyk; 5+ let backendu není doloženo. Neuloženo na LinkedIn kvůli jazykové překážce.",
      "Norwegian is the working language; 5+ backend years are not documented. Not saved on LinkedIn due to the language barrier.",
    ),
  },
  {
    id: "tms-fullstack",
    company: "TMS Technology",
    title: "Full Stack Engineer",
    url: li("4470426453"),
    aliases: [],
    source: "LinkedIn",
    location: "Greater Oslo",
    arrangement: "On-site · Full-time",
    stack: ["React", "C#/.NET", "Azure"],
    points: [20, 8, 7, 10, 0],
    blocker: true,
    postedLabel: "3 weeks ago",
    summary: l(
      "Fullstack role s významnou backendovou částí v .NET.",
      "Fullstack role with substantial .NET backend responsibility.",
    ),
    evidence: l(
      "Frontend a integrační zkušenost jsou relevantní.",
      "Frontend and integration experience are relevant.",
    ),
    gaps: l(
      "Norština B2 je povinná a hledá se hluboké .NET plus 5+ let. Neuloženo na LinkedIn.",
      "Norwegian B2 is mandatory, alongside deep .NET and 5+ years. Not saved on LinkedIn.",
    ),
  },
  {
    id: "sensio-ml",
    company: "Sensio",
    title: "Machine Learning Engineer – Computer Vision",
    url: hub("6a3092f6126ff00b931df15c"),
    aliases: [],
    source: "The Hub",
    location: "Oslo",
    arrangement: "Full-time",
    stack: ["Python", "PyTorch", "Computer vision", "Edge ML"],
    points: [4, 3, 2, 10, 10],
    blocker: true,
    summary: l(
      "Specializované strojové vidění a modely pro senzory a edge zařízení.",
      "Specialized computer vision and models for sensors and edge devices.",
    ),
    evidence: l(
      "Zkušenost s IoT provozem poskytuje kontext, ne kvalifikaci v ML výzkumu.",
      "IoT operations provide context, not ML research qualifications.",
    ),
    gaps: l(
      "MSc/PhD, Python/PyTorch a computer vision nejsou doložené. n8n ani LangChain tyto požadavky nenahrazují.",
      "MSc/PhD, Python/PyTorch and computer vision are not documented. n8n and LangChain do not replace them.",
    ),
  },
];

export function researchScore(job: ResearchJob): number {
  const total = job.points.reduce((sum, point) => sum + point, 0);
  return job.blocker ? Math.min(total, job.points[4] === 0 ? 49 : 59) : total;
}
export function canonicalJobUrl(value: string | null | undefined): string {
  try {
    const u = new URL(value ?? "");
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return value ?? "";
  }
}
export function researchForUrl(
  url: string | null | undefined,
): ResearchJob | undefined {
  const key = canonicalJobUrl(url);
  return OSLO_JOBS.find((job) =>
    [job.url, ...job.aliases].some((value) => canonicalJobUrl(value) === key),
  );
}
export function researchIsStale(job: ResearchJob, now = new Date()): boolean {
  return (
    !!job.needsRecheck ||
    now.getTime() - Date.parse(OSLO_RESEARCHED_ON) > 35 * 86400000 ||
    (!!job.deadline && now.toISOString().slice(0, 10) > job.deadline)
  );
}
