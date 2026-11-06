/** Official careers destinations for software roles in Prague, Brno or
 * remote from Czechia, checked 2026-11-06. A directory, not a claim of a
 * matching live vacancy: inspect each posting's stack and language. */
export const CZECH_COMPANIES_CHECKED_ON = "2026-11-06";

export type CzechCompany = {
  name: string;
  url: string;
  category: "Product" | "AI" | "Agency" | "Finance" | "Commerce" | "Enterprise" | "Public";
  city: string;
  checkedOn: string;
  notes: { cs: string; en: string };
};

export const CZECH_COMPANIES: CzechCompany[] = [
  {
    "name": "ABRA Software",
    "url": "https://www.abra.eu/kariera/",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "ERP a účetní software (ABRA Gen, Flexi); vlastní vývoj.",
      "en": "ERP and accounting software (ABRA Gen, Flexi); in-house development."
    }
  },
  {
    "name": "ABUGO (Smartsupp, Reservio, Shopsys)",
    "url": "https://www.abugo.com/careers",
    "category": "Product",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Skupina SaaS produktů pro e-commerce a rezervace; PHP, TypeScript.",
      "en": "Group of e-commerce and booking SaaS products; PHP, TypeScript."
    }
  },
  {
    "name": "Accenture",
    "url": "https://www.accenture.com/cz-en/careers",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Konzultace a vývoj softwaru pro korporace.",
      "en": "Consulting and software engineering for enterprises."
    }
  },
  {
    "name": "Ackee",
    "url": "https://www.ackee.cz/kariera",
    "category": "Agency",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj mobilních a webových aplikací na zakázku.",
      "en": "Custom mobile and web app development."
    }
  },
  {
    "name": "Actum Digital",
    "url": "https://www.actumdigital.com/careers",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "CX a commerce implementace (Salesforce, SAP Commerce).",
      "en": "CX and commerce implementations (Salesforce, SAP Commerce)."
    }
  },
  {
    "name": "Adastra",
    "url": "https://adastracorp.com/cs/kariera/",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Data, AI a softwarové konzultace.",
      "en": "Data, AI and software consulting."
    }
  },
  {
    "name": "Air Bank",
    "url": "https://kariera.airbank.cz/",
    "category": "Finance",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Digitální banka s vlastním vývojem v Praze a Brně.",
      "en": "Digital bank with in-house development in Prague and Brno."
    }
  },
  {
    "name": "Allwyn Česko",
    "url": "https://allwyn.jobs.cz/",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Loterie a hry (dříve Sazka); vlastní vývoj digitálních produktů.",
      "en": "Lottery and gaming (formerly Sazka); in-house digital products."
    }
  },
  {
    "name": "Alma Career",
    "url": "https://www.almacareer.com/careers",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Pracovní portály (Jobs.cz, Prace.cz, Teamio); vlastní vývoj.",
      "en": "Job portals (Jobs.cz, Prace.cz, Teamio); in-house development."
    }
  },
  {
    "name": "Alza",
    "url": "https://kariera.alza.cz/oddeleni/it/",
    "category": "Commerce",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Největší česká e-commerce; IT oddělení s webem, .NET a mobilními aplikacemi.",
      "en": "Largest Czech e-commerce; IT department across web, .NET and mobile."
    }
  },
  {
    "name": "Apify",
    "url": "https://apify.com/jobs",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Platforma pro web scraping a automatizaci; Node.js a TypeScript.",
      "en": "Web scraping and automation platform; Node.js and TypeScript."
    }
  },
  {
    "name": "Applifting",
    "url": "https://applifting.io/careers",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj softwaru na zakázku; TypeScript, React, Node.js, Python.",
      "en": "Custom software development; TypeScript, React, Node.js, Python."
    }
  },
  {
    "name": "Aricoma",
    "url": "https://www.aricoma.com/about-us/career",
    "category": "Enterprise",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Velká IT skupina; vývoj softwaru, integrace a cloud.",
      "en": "Large IT group; software development, integration and cloud."
    }
  },
  {
    "name": "Ataccama",
    "url": "https://jobs.ataccama.com/",
    "category": "Product",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Software pro kvalitu dat a MDM; Java a webový frontend v Reactu.",
      "en": "Data quality and MDM software; Java and React web frontend."
    }
  },
  {
    "name": "Avenga",
    "url": "https://career.avenga.com/jobs?location=Prague&query=",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Softwarové služby; klientské projekty v JS, Javě a .NET.",
      "en": "Software services; client projects in JS, Java and .NET."
    }
  },
  {
    "name": "Banka Creditas",
    "url": "https://creditas.jobs.cz/",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Banka s rostoucím interním IT.",
      "en": "Bank with growing in-house IT."
    }
  },
  {
    "name": "Barclays",
    "url": "https://search.jobs.barclays/location/prague-jobs/22545/3077311-3067695-3067696/4",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Technologické centrum banky v Praze; Java, web a data.",
      "en": "Bank technology centre in Prague; Java, web and data."
    }
  },
  {
    "name": "Behavio",
    "url": "https://www.behaviolabs.com/careers",
    "category": "AI",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Spotřebitelský výzkum a analytika značek; datové a webové produkty.",
      "en": "Consumer research and brand analytics; data and web products."
    }
  },
  {
    "name": "BigHub",
    "url": "https://www.bighub.ai/careers",
    "category": "AI",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Nasazování enterprise AI a datových řešení do produkce.",
      "en": "Enterprise AI and data solutions in production."
    }
  },
  {
    "name": "Blindspot AI",
    "url": "https://blindspot.ai/career",
    "category": "AI",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "AI a optimalizační software pro plánování a logistiku.",
      "en": "AI and optimisation software for planning and logistics."
    }
  },
  {
    "name": "Bohemia Interactive",
    "url": "https://careers.bohemia.net/en",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj her (Arma, DayZ); C++ a online služby.",
      "en": "Game development (Arma, DayZ); C++ and online services."
    }
  },
  {
    "name": "Braiins",
    "url": "https://braiins.com/careers",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Software pro těžbu bitcoinu (Braiins Pool, OS); Rust, Python, web.",
      "en": "Bitcoin mining software (Braiins Pool, OS); Rust, Python, web."
    }
  },
  {
    "name": "Cisco",
    "url": "https://careers.cisco.com/global/en",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Síťové a kolaborační technologie; pražské vývojové týmy.",
      "en": "Networking and collaboration tech; Prague engineering teams."
    }
  },
  {
    "name": "Cleevio",
    "url": "https://cleevio.com/careers",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj digitálních produktů a fintech/web3 aplikací.",
      "en": "Digital product and fintech/web3 app development."
    }
  },
  {
    "name": "CNC (Czech News Center)",
    "url": "https://www.cncenter.cz/kariera",
    "category": "Commerce",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Mediální dům (Blesk, iSport); interní webový vývoj.",
      "en": "Media house (Blesk, iSport); in-house web development."
    }
  },
  {
    "name": "Cookielab",
    "url": "https://cookielab.io/en/careers/",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Softwarový vývoj a cloud/DevOps na zakázku.",
      "en": "Custom software development and cloud/DevOps."
    }
  },
  {
    "name": "Daktela",
    "url": "https://daktela.com/resources/careers",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Cloudové kontaktní centrum a komunikační SaaS.",
      "en": "Cloud contact centre and communication SaaS."
    }
  },
  {
    "name": "Dataddo",
    "url": "https://www.dataddo.com/careers/",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Platforma pro datové integrace (ETL) bez kódu; backend Go, webový frontend.",
      "en": "No-code data integration (ETL) platform; Go backend and web frontend."
    }
  },
  {
    "name": "Datamole",
    "url": "https://www.datamole.ai/careers",
    "category": "AI",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Softwarová firma pro data a AI; Python a cloudová řešení.",
      "en": "Data and AI software company; Python and cloud solutions."
    }
  },
  {
    "name": "Deepnote",
    "url": "https://deepnote.com/join-us",
    "category": "AI",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Datové notebooky s AI; TypeScript/React a Python.",
      "en": "AI data notebooks; TypeScript/React and Python."
    }
  },
  {
    "name": "DHL IT Services",
    "url": "https://careers.dhl.com/global/en/its-czech-republic",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Velké IT centrum v Praze; webové aplikace, Java a cloud.",
      "en": "Large Prague IT hub; web apps, Java and cloud."
    }
  },
  {
    "name": "Digitální a informační agentura",
    "url": "https://www.dia.gov.cz/cs/kariera",
    "category": "Public",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Státní agentura pro digitalizaci státní správy.",
      "en": "State agency for public administration digitalisation."
    }
  },
  {
    "name": "Direct pojišťovna",
    "url": "https://www.chcidodirectu.cz/",
    "category": "Finance",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Pojišťovna s vlastním vývojem online prodeje.",
      "en": "Insurer with in-house development of online sales."
    }
  },
  {
    "name": "Dr.Max",
    "url": "https://kariera.drmax.cz/",
    "category": "Commerce",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Lékárenská síť s e-shopem a digitálním týmem.",
      "en": "Pharmacy chain with e-commerce and digital team."
    }
  },
  {
    "name": "Ecomail",
    "url": "https://ecomail.cz/kariera/",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "SaaS pro e-mailový marketing s kanceláří v centru Prahy.",
      "en": "Email marketing SaaS with an office in central Prague."
    }
  },
  {
    "name": "Economia",
    "url": "https://www.economia.cz/prace-u-nas/",
    "category": "Commerce",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vydavatel (Aktuálně.cz, Hospodářské noviny); webový vývoj.",
      "en": "Publisher (Aktuálně.cz, Hospodářské noviny); web development."
    }
  },
  {
    "name": "Edhouse",
    "url": "https://www.edhouse.eu/cz/kariera/",
    "category": "Agency",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj softwaru a embedded systémů; C#, .NET.",
      "en": "Software and embedded development; C#, .NET."
    }
  },
  {
    "name": "Eman",
    "url": "https://eman.cz/kariera/",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj softwaru a UX pro firmy; web a mobil.",
      "en": "Software development and UX for businesses; web and mobile."
    }
  },
  {
    "name": "Embedit",
    "url": "https://www.embedit.com/careers",
    "category": "Finance",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Technologická firma skupiny Home Credit; Java, React, mikrofrontendy.",
      "en": "Home Credit group tech company; Java, React, micro-frontends."
    }
  },
  {
    "name": "Emplifi",
    "url": "https://emplifi.io/careers/",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "SaaS pro marketing na sociálních sítích (dříve Socialbakers); TypeScript, Node.js.",
      "en": "Social media marketing SaaS (formerly Socialbakers); TypeScript, Node.js."
    }
  },
  {
    "name": "Etnetera",
    "url": "https://www.etnetera.cz/prace-u-nas",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Velké IT projekty na zakázku; Java a webové technologie.",
      "en": "Large custom IT projects; Java and web technologies."
    }
  },
  {
    "name": "Everpure (Pure Storage)",
    "url": "https://www.everpuredata.com/company/careers.html",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Datová úložiště, pražské R&D; C/C++, Python, Go.",
      "en": "Data storage with Prague R&D; C/C++, Python, Go."
    }
  },
  {
    "name": "Expedia Group",
    "url": "https://careers.expediagroup.com/locations/prague-czechia/",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Cestovní technologie s pražskou pobočkou; ověřit inženýrské role.",
      "en": "Travel tech with a Prague office; check engineering openings."
    }
  },
  {
    "name": "Fakturoid",
    "url": "https://www.fakturoid.cz/kariera",
    "category": "Product",
    "city": "Remote",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Online fakturace pro OSVČ a firmy; vzdálený tým, Ruby on Rails.",
      "en": "Online invoicing for freelancers and firms; remote team, Ruby on Rails."
    }
  },
  {
    "name": "Fio banka",
    "url": "https://fio.jobs.cz/",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Banka s vlastním vývojem softwaru a obchodních systémů.",
      "en": "Bank developing its own banking and trading software."
    }
  },
  {
    "name": "Fortuna Entertainment Group",
    "url": "https://feg.eu/career/",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Sázková skupina s technologickými týmy v Praze.",
      "en": "Betting group with technology teams in Prague."
    }
  },
  {
    "name": "FTMO",
    "url": "https://careers.ftmo.com/en/",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Prop trading fintech; interní vývoj webových aplikací a platforem.",
      "en": "Prop trading fintech; in-house web application and platform development."
    }
  },
  {
    "name": "Futured",
    "url": "https://futured.app/cs/kariera",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Mobilní a webové aplikace na zakázku.",
      "en": "Custom mobile and web apps."
    }
  },
  {
    "name": "Gauss Algorithmic",
    "url": "https://www.gaussalgo.com/open-positions",
    "category": "AI",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "AI a datová řešení na zakázku; Python, ML.",
      "en": "Custom AI and data solutions; Python, ML."
    }
  },
  {
    "name": "Gen Digital",
    "url": "https://www.gendigital.com/us/en/life-gen/",
    "category": "Enterprise",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Spotřebitelská kyberbezpečnost (Avast, Norton); C++, backend i webové týmy.",
      "en": "Consumer cybersecurity (Avast, Norton); C++, backend and web teams."
    }
  },
  {
    "name": "Generali Česká pojišťovna",
    "url": "https://generaliceska.jobs.cz/",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Pojišťovna s interním IT a digitálními kanály.",
      "en": "Insurer with in-house IT and digital channels."
    }
  },
  {
    "name": "GoodAI",
    "url": "https://www.goodai.com/careers/",
    "category": "AI",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Výzkum obecné AI a hry s AI agenty.",
      "en": "General AI research and games with AI agents."
    }
  },
  {
    "name": "GoodData",
    "url": "https://www.gooddata.ai/company/careers/",
    "category": "Product",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Analytická a BI platforma; frontend TypeScript/React, backend Kotlin, Java, Python.",
      "en": "Analytics/BI platform; TypeScript/React frontend, Kotlin, Java, Python backend."
    }
  },
  {
    "name": "Groupon",
    "url": "https://job-boards.greenhouse.io/groupon",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Marketplace slev s velkým pražským vývojem; Java, Node.js, React.",
      "en": "Deals marketplace with a large Prague engineering hub; Java, Node.js, React."
    }
  },
  {
    "name": "Home Credit",
    "url": "https://www.homecredit.net/careers/",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Spotřebitelské financování, centrála skupiny v Praze.",
      "en": "Consumer finance, group headquarters in Prague."
    }
  },
  {
    "name": "Honeywell",
    "url": "https://careers.honeywell.com/",
    "category": "Enterprise",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Průmyslový software a technologie; vývojové centrum v Brně.",
      "en": "Industrial software and technology; Brno engineering centre."
    }
  },
  {
    "name": "ICZ",
    "url": "https://icz.jobs.cz/",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "IT pro státní správu a zdravotnictví; Java, .NET.",
      "en": "IT for public sector and healthcare; Java, .NET."
    }
  },
  {
    "name": "Inventi",
    "url": "https://www.inventi.cz/kariera",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj softwaru na zakázku a týmy pro korporace.",
      "en": "Custom software development and teams for enterprises."
    }
  },
  {
    "name": "iQuest",
    "url": "https://www.iquest.cz/cs/volne-pozice-vyvojari",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "IT personální agentura; projekty pro banky a enterprise klienty.",
      "en": "IT staffing agency; bank and enterprise client projects."
    }
  },
  {
    "name": "JetBrains",
    "url": "https://www.jetbrains.com/careers/jobs/?location=Prague",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývojářské nástroje (IntelliJ, Kotlin); Kotlin/Java, část týmů web a TypeScript.",
      "en": "Developer tools (IntelliJ, Kotlin); Kotlin/Java, some web and TypeScript teams."
    }
  },
  {
    "name": "Keboola",
    "url": "https://www.keboola.com/about/jobs",
    "category": "Product",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Datová platforma; PHP, Python a TypeScript/React.",
      "en": "Data platform; PHP, Python and TypeScript/React."
    }
  },
  {
    "name": "Kentico",
    "url": "https://jobs.kentico.com/",
    "category": "Product",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "CMS a DXP Xperience by Kentico; .NET/C# a frontend v Reactu.",
      "en": "Xperience by Kentico CMS/DXP; .NET/C# and React frontend."
    }
  },
  {
    "name": "Kiwi.com",
    "url": "https://jobs.kiwi.com/",
    "category": "Product",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vyhledávání a prodej letenek; backend Python, frontend React/TypeScript.",
      "en": "Travel search and booking; Python backend, React/TypeScript frontend."
    }
  },
  {
    "name": "Komerční banka",
    "url": "https://kariera.kb.cz/",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Banka skupiny Société Générale; interní IT a digitální vývoj.",
      "en": "Société Générale group bank; in-house IT and digital development."
    }
  },
  {
    "name": "Kontent.ai",
    "url": "https://kontent.ai/careers/",
    "category": "Product",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Headless CMS SaaS; .NET, React a TypeScript.",
      "en": "Headless CMS SaaS; .NET, React and TypeScript."
    }
  },
  {
    "name": "Kooperativa",
    "url": "https://www.koop.cz/pojistovna-kooperativa/kariera",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Pojišťovna skupiny VIG; interní IT.",
      "en": "VIG group insurer; in-house IT."
    }
  },
  {
    "name": "Liftago",
    "url": "https://www.liftago.cz/kariera",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Platforma pro taxi a doručování; mobilní a webové aplikace.",
      "en": "Taxi and delivery platform; mobile and web apps."
    }
  },
  {
    "name": "Livesport",
    "url": "https://livesport.recruitee.com/",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Sportovní výsledky (Livesport, Flashscore); TypeScript, Go, mobilní aplikace.",
      "en": "Sports results (Livesport, Flashscore); TypeScript, Go, mobile apps."
    }
  },
  {
    "name": "Lundegaard",
    "url": "https://www.lundegaard.eu/kariera",
    "category": "Agency",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Digitální řešení pro finance a pojišťovny; Java, React.",
      "en": "Digital solutions for finance and insurance; Java, React."
    }
  },
  {
    "name": "Madfinger Games",
    "url": "https://www.madfingergames.com/careers",
    "category": "Product",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj her pro PC a mobil; Unity, C#, C++.",
      "en": "PC and mobile game development; Unity, C#, C++."
    }
  },
  {
    "name": "Make",
    "url": "https://www.make.com/careers",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "No-code automatizační platforma, Praha je hlavní hub; Node.js a TypeScript.",
      "en": "No-code automation platform with Prague as main hub; Node.js and TypeScript."
    }
  },
  {
    "name": "Mapy.com",
    "url": "https://mapy.com/en/kariera",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Mapy a navigace, oddělené od Seznamu; web a mobilní aplikace.",
      "en": "Maps and navigation spun off from Seznam; web and mobile apps."
    }
  },
  {
    "name": "Medevio",
    "url": "https://www.medevio.cz/joinus",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Healthtech pro komunikaci pacientů s lékaři; web a mobilní aplikace.",
      "en": "Healthtech for patient-doctor communication; web and mobile apps."
    }
  },
  {
    "name": "Mews",
    "url": "https://www.mews.com/en/careers",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Cloudový hotelový systém (PMS); backend .NET/C#, frontend React/TypeScript.",
      "en": "Cloud hotel management (PMS); .NET/C# backend, React/TypeScript frontend."
    }
  },
  {
    "name": "MONETA Money Bank",
    "url": "https://moneta.jobs.cz/",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Banka s interním IT a digitálním bankovnictvím.",
      "en": "Bank with in-house IT and digital banking."
    }
  },
  {
    "name": "MoroSystems",
    "url": "https://www.morosystems.cz/kariera/",
    "category": "Agency",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj softwaru na zakázku; Java, React.",
      "en": "Custom software development; Java, React."
    }
  },
  {
    "name": "NAKIT",
    "url": "https://nakit.jobs.cz/",
    "category": "Public",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Státní IT firma; vývoj a provoz státních systémů.",
      "en": "State IT company; development and operation of government systems."
    }
  },
  {
    "name": "NetApp",
    "url": "https://careers.netapp.com/",
    "category": "Enterprise",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Datová úložiště a cloud; vývojové centrum v Brně.",
      "en": "Data storage and cloud; Brno engineering centre."
    }
  },
  {
    "name": "NiCE",
    "url": "https://www.nice.com/careers",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "CX software; pražský vývoj CXone (dříve Brand Embassy).",
      "en": "CX software; Prague engineering for CXone (formerly Brand Embassy)."
    }
  },
  {
    "name": "Notino",
    "url": "https://career.notino.cz/",
    "category": "Commerce",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "E-shop s kosmetikou a parfémy; vlastní IT, .NET a React.",
      "en": "Beauty and fragrance e-commerce; in-house IT, .NET and React."
    }
  },
  {
    "name": "Notum",
    "url": "https://www.notum.tech/careers",
    "category": "Agency",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Agentura pro Strapi, Payload CMS a Next.js; Node.js, React.",
      "en": "Strapi, Payload CMS and Next.js agency; Node.js, React."
    }
  },
  {
    "name": "O2 Czech Republic",
    "url": "https://kariera.o2.cz/",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Telekomunikace s interním IT a vývojem.",
      "en": "Telecom with in-house IT and development."
    }
  },
  {
    "name": "Operátor ICT (OICT)",
    "url": "https://operatorict.cz/kariera",
    "category": "Public",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Městská IT firma Prahy (Golemio, Lítačka).",
      "en": "Prague city IT company (Golemio, Lítačka)."
    }
  },
  {
    "name": "Oracle",
    "url": "https://careers.oracle.com/en/sites/jobsearch",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Pražské vývojové centrum (cloud, NetSuite).",
      "en": "Prague development centre (cloud, NetSuite)."
    }
  },
  {
    "name": "Outreach",
    "url": "https://www.outreach.ai/company/working-at-outreach",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Americký sales-engagement SaaS s pražským vývojovým centrem; React a TypeScript.",
      "en": "US sales-engagement SaaS with a Prague engineering hub; React and TypeScript."
    }
  },
  {
    "name": "Packeta (Zásilkovna)",
    "url": "https://www.zasilkovna.cz/kariera",
    "category": "Commerce",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Doručování zásilek; velké interní IT a vývoj.",
      "en": "Parcel delivery; large in-house IT and development."
    }
  },
  {
    "name": "Partners",
    "url": "https://www.partners.cz/kariera",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Finanční skupina a Partners Banka; interní IT vývoj.",
      "en": "Financial group and Partners Banka; in-house IT development."
    }
  },
  {
    "name": "Phrase",
    "url": "https://phrase.com/careers/",
    "category": "Product",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Lokalizační platforma (dříve Memsource); Java, TypeScript/React.",
      "en": "Localisation platform (formerly Memsource); Java, TypeScript/React."
    }
  },
  {
    "name": "Pipedrive",
    "url": "https://www.pipedrive.com/en/jobs/prague",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "CRM SaaS s vývojovou pobočkou v Praze; Node.js, TypeScript, React.",
      "en": "CRM SaaS with a Prague engineering office; Node.js, TypeScript, React."
    }
  },
  {
    "name": "Portu",
    "url": "https://www.portu.cz/o-nas/kariera",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Investiční aplikace a robo-advisor; vlastní vývoj.",
      "en": "Investment app and robo-advisor; in-house development."
    }
  },
  {
    "name": "Pricefx",
    "url": "https://www.pricefx.com/career",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Cloudový software pro cenotvorbu s velkým pražským vývojem; Java, Groovy, web.",
      "en": "Cloud pricing software with a large Prague R&D; Java, Groovy, web."
    }
  },
  {
    "name": "Productboard",
    "url": "https://www.productboard.com/careers/",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Product management SaaS; webový frontend v TypeScriptu a Reactu.",
      "en": "Product management SaaS; web frontend in TypeScript and React."
    }
  },
  {
    "name": "Prusa Research",
    "url": "https://www.prusa3d.com/cs/stranka/volna-mista-ve-vyvoji_228277/",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "3D tiskárny; vývojové pozice od firmwaru po software a web.",
      "en": "3D printers; engineering roles from firmware to software and web."
    }
  },
  {
    "name": "Purple Technology",
    "url": "https://www.purple-technology.com/",
    "category": "Product",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Fintech software pro obchodování; AWS, serverless, TypeScript.",
      "en": "Fintech trading software; AWS, serverless, TypeScript."
    }
  },
  {
    "name": "Qest technologies",
    "url": "https://www.qest.cz/en/career",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Softwarová firma; webové aplikace a AI fullstack role.",
      "en": "Software company; web applications and AI fullstack roles."
    }
  },
  {
    "name": "Raiffeisenbank",
    "url": "https://rb.jobs.cz/",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Banka s interním IT a vývojem digitálních služeb.",
      "en": "Bank with in-house IT and digital development."
    }
  },
  {
    "name": "Recombee",
    "url": "https://www.recombee.com/jobs",
    "category": "AI",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Doporučovací systém jako služba (AI personalizace).",
      "en": "Recommendation engine as a service (AI personalisation)."
    }
  },
  {
    "name": "Red Hat",
    "url": "https://www.redhat.com/en/jobs",
    "category": "Enterprise",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Open source (Linux, OpenShift); Brno je velké vývojové centrum; Go, Python, TypeScript.",
      "en": "Open source (Linux, OpenShift); Brno is a major engineering site; Go, Python, TypeScript."
    }
  },
  {
    "name": "Resistant AI",
    "url": "https://resistant.ai/career/",
    "category": "AI",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "AI detekce finančních podvodů a falešných dokumentů; Python a ML.",
      "en": "AI detection of financial crime and document fraud; Python and ML."
    }
  },
  {
    "name": "Rohlik Group",
    "url": "https://www.rohlik.group/work-with-us",
    "category": "Commerce",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Online supermarket (Rohlik, Knuspr, Gurkerl); vlastní vývoj e-commerce a logistiky.",
      "en": "Online grocery (Rohlik, Knuspr, Gurkerl); in-house e-commerce and logistics engineering."
    }
  },
  {
    "name": "Rossum",
    "url": "https://rossum.ai/careers/",
    "category": "AI",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "AI zpracování obchodních dokumentů; Python a React/TypeScript.",
      "en": "AI document processing for business; Python and React/TypeScript."
    }
  },
  {
    "name": "Salsita",
    "url": "https://salsita.ai/career",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Webový vývoj a AI pro klienty; React, TypeScript a Node.js.",
      "en": "Web and AI development for clients; React, TypeScript and Node.js."
    }
  },
  {
    "name": "SatoshiLabs",
    "url": "https://satoshilabs.com/careers",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Trezor hardwarové peněženky; Trezor Suite v TypeScriptu a Reactu.",
      "en": "Trezor hardware wallets; Trezor Suite in TypeScript and React."
    }
  },
  {
    "name": "SCS Software",
    "url": "https://www.scssoft.com/jobs",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj simulátorů (Euro Truck Simulator); C++.",
      "en": "Simulation games (Euro Truck Simulator); C++."
    }
  },
  {
    "name": "SentinelOne",
    "url": "https://www.sentinelone.com/jobs/",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Kyberbezpečnost s pobočkou v Praze; ověřit frontendové a fullstack role.",
      "en": "Cybersecurity with a Prague office; check frontend and fullstack openings."
    }
  },
  {
    "name": "Seznam.cz",
    "url": "https://o-seznam.cz/kariera/",
    "category": "Product",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vyhledávač, média a reklama; Python, Go, JavaScript/TypeScript.",
      "en": "Czech search, media and ads; Python, Go, JavaScript/TypeScript."
    }
  },
  {
    "name": "Shoptet",
    "url": "https://kariera.shoptet.cz/",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "SaaS platforma pro e-shopy; PHP a JavaScript.",
      "en": "E-commerce SaaS platform; PHP and JavaScript."
    }
  },
  {
    "name": "SmartEmailing",
    "url": "https://www.smartemailing.cz/kariera/",
    "category": "Product",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "SaaS pro e-mailový marketing; PHP.",
      "en": "Email marketing SaaS; PHP."
    }
  },
  {
    "name": "SolarWinds",
    "url": "https://jobs.solarwinds.com/",
    "category": "Enterprise",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "IT observability software; vývojové centrum v Brně.",
      "en": "IT observability software; engineering centre in Brno."
    }
  },
  {
    "name": "STRV",
    "url": "https://www.strv.com/careers",
    "category": "Agency",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Digitální produktové studio; React, Node.js, mobilní vývoj.",
      "en": "Digital product studio; React, Node.js, mobile."
    }
  },
  {
    "name": "SUSE",
    "url": "https://www.suse.com/careers/",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Linux a cloud-native software; vývojová kancelář v Praze.",
      "en": "Linux and cloud-native software; Prague engineering office."
    }
  },
  {
    "name": "Symbio",
    "url": "https://symbio.agency/cs/kariera",
    "category": "Agency",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Digitální produktová agentura; web, mobil, UX.",
      "en": "Digital product agency; web, mobile, UX."
    }
  },
  {
    "name": "T-Mobile Czech Republic",
    "url": "https://www.t-kariera.cz/",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Telekomunikace s interním IT a digitálními kanály.",
      "en": "Telecom with in-house IT and digital channels."
    }
  },
  {
    "name": "Thermo Fisher Scientific",
    "url": "https://jobs.thermofisher.com/",
    "category": "Enterprise",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Software pro elektronové mikroskopy vyvíjený v Brně.",
      "en": "Software for electron microscopes developed in Brno."
    }
  },
  {
    "name": "ThreatMark",
    "url": "https://www.threatmark.com/careers",
    "category": "Product",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Prevence podvodů v digitálním bankovnictví; behaviorální analýza.",
      "en": "Fraud prevention for digital banking; behavioural analytics."
    }
  },
  {
    "name": "Tietoevry",
    "url": "https://careers.tieto.com/czechia-careers",
    "category": "Enterprise",
    "city": "Praha · Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj softwaru a IT služby; pobočky v Praze, Brně a Ostravě.",
      "en": "Software and IT services; offices in Prague, Brno and Ostrava."
    }
  },
  {
    "name": "Trask",
    "url": "https://wearetrask.com/en",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Systémová integrace a digitalizace pro banky a firmy.",
      "en": "System integration and digital solutions for banks and enterprises."
    }
  },
  {
    "name": "Twisto",
    "url": "https://twisto.recruitee.com/",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Fintech pro odložené platby a platební kartu; Python a webový frontend.",
      "en": "Fintech for deferred payments and cards; Python and web frontend."
    }
  },
  {
    "name": "UniCredit Bank CZ",
    "url": "https://unicreditbank.jobs.cz/",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Banka s interními IT a digitálními týmy.",
      "en": "Bank with in-house IT and digital teams."
    }
  },
  {
    "name": "Vodafone Czech Republic",
    "url": "https://vodafone.jobs.cz/",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Telekomunikace s interním IT.",
      "en": "Telecom with in-house IT."
    }
  },
  {
    "name": "Warhorse Studios",
    "url": "https://warhorsestudios.cz/cs/kariera",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj her (Kingdom Come: Deliverance); C++.",
      "en": "Game development (Kingdom Come: Deliverance); C++."
    }
  },
  {
    "name": "Webnode",
    "url": "https://www.pracevnebi.cz/en/",
    "category": "Product",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Tvorba webových stránek pro miliony uživatelů; webový vývoj.",
      "en": "Website builder for millions of users; web development."
    }
  },
  {
    "name": "Wrike",
    "url": "https://www.wrike.com/jobs/",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Work management SaaS s pražskou vývojovou kanceláří.",
      "en": "Work management SaaS with a Prague engineering office."
    }
  },
  {
    "name": "Wultra",
    "url": "https://www.wultra.com/careers",
    "category": "Product",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Bezpečnost mobilního bankovnictví a autentizace; Java, mobilní SDK.",
      "en": "Mobile banking security and authentication; Java, mobile SDKs."
    }
  },
  {
    "name": "Y Soft",
    "url": "https://www.ysoft.com/careers",
    "category": "Product",
    "city": "Brno",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Software pro správu tisku (SAFEQ); Java, .NET, web.",
      "en": "Print management software (SAFEQ); Java, .NET, web."
    }
  },
  {
    "name": "Yieldigo",
    "url": "https://www.yieldigo.com/careers/",
    "category": "AI",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "AI software pro cenotvorbu v retailu.",
      "en": "AI pricing software for retail."
    }
  },
  {
    "name": "Zentity",
    "url": "https://www.zentity.com/career/",
    "category": "Agency",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Vývoj softwaru na zakázku a cloud, hlavně Microsoft stack.",
      "en": "Custom software and cloud, mostly Microsoft stack."
    }
  },
  {
    "name": "Česká národní banka",
    "url": "https://www.cnb.cz/cs/o_cnb/kariera/",
    "category": "Public",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Centrální banka s interním IT a vývojem aplikací.",
      "en": "Central bank with in-house IT and application development."
    }
  },
  {
    "name": "Česká spořitelna",
    "url": "https://kariera.csas.cz/",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Banka skupiny Erste; IT a vývoj George.",
      "en": "Erste group bank; IT and George digital banking."
    }
  },
  {
    "name": "Česká televize",
    "url": "https://www.ceskatelevize.cz/vse-o-ct/kariera/",
    "category": "Public",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Veřejnoprávní televize; vývoj iVysílání a webů.",
      "en": "Public broadcaster; iVysílání and web development."
    }
  },
  {
    "name": "ČEZ",
    "url": "https://kdejinde.jobs.cz/",
    "category": "Enterprise",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Energetická skupina s interním IT.",
      "en": "Energy group with in-house IT."
    }
  },
  {
    "name": "ČSOB",
    "url": "https://www.csob.cz/portal/kariera",
    "category": "Finance",
    "city": "Praha",
    "checkedOn": "2026-11-06",
    "notes": {
      "cs": "Banka s rozsáhlým interním IT a digitálními kanály.",
      "en": "Bank with large in-house IT and digital channels."
    }
  }
];
