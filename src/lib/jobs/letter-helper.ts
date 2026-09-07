export type LetterLanguage = "en" | "cs";
export type Evidence = {
  id: string;
  employer: string;
  domain: RegExp;
  stack: RegExp;
  label: Record<LetterLanguage, string>;
  paragraph: Record<LetterLanguage, string>;
};

// Public portfolio + explicitly supplied career context. These are editable
// evidence suggestions, not invented achievements or generated hiring claims.
export const CAREER_EVIDENCE: Evidence[] = [
  {
    id: "embedit",
    employer: "EmbedIT",
    domain: /fintech|bank|payment|financial|finance|bankovn|plateb|finanč/i,
    stack: /react|typescript|bff|micro.?frontend|api|accessib|test/i,
    label: {
      en: "Banking frontend and BFF delivery",
      cs: "Frontend a BFF v bankovnictví",
    },
    paragraph: {
      en: "At EmbedIT, I worked on online-banking modernization, including frontend and BFF architecture, API contracts, testing, and accessibility.",
      cs: "V EmbedIT jsem pracoval na modernizaci internetového bankovnictví, včetně frontendu, BFF architektury, API kontraktů, testování a přístupnosti.",
    },
  },
  {
    id: "entain",
    employer: "Entain · Gibraltar",
    domain:
      /fintech|bank|payment|financial|finance|fraud|aml|risk|compliance|finanč|podvod/i,
    stack: /fraud|aml|compliance|risk|gdpr/i,
    label: {
      en: "Financial risk and customer protection",
      cs: "Finanční rizika a ochrana zákazníků",
    },
    paragraph: {
      en: "Before moving into software development, I worked in customer protection at Entain in Gibraltar. That experience gave me practical context for fraud, AML, and handling sensitive customer information.",
      cs: "Před přechodem k vývoji softwaru jsem pracoval v ochraně zákazníků v Entainu na Gibraltaru. Získal jsem tak praktický kontext pro odhalování podvodů, AML a práci s citlivými údaji zákazníků.",
    },
  },
  {
    id: "controlant",
    employer: "Controlant",
    domain:
      /pharma|health|medical|clinical|life science|cold.?chain|healthcare|zdravot|farmac|léčiv/i,
    stack: /iot|monitoring|incident|telemetry|supply.chain/i,
    label: {
      en: "Pharmaceutical cold-chain operations",
      cs: "Provoz farmaceutického chladového řetězce",
    },
    paragraph: {
      en: "At Controlant, I investigated incidents affecting pharmaceutical shipments using IoT telemetry. That operational experience helps me understand why reliability and clear information matter to people using healthcare systems.",
      cs: "V Controlantu jsem s využitím IoT telemetrie řešil incidenty při přepravě farmaceutických zásilek. Díky této provozní zkušenosti rozumím tomu, proč jsou pro uživatele zdravotnických systémů spolehlivost a srozumitelné informace zásadní.",
    },
  },
  {
    id: "ersilia",
    employer: "Ersilia",
    domain:
      /pharma|health|medical|science|scientific|research|zdravot|farmac|výzkum/i,
    stack: /next|typescript|node|postgres|\bai\b|validation|schema/i,
    label: {
      en: "Full-stack tools for open science",
      cs: "Fullstack nástroje pro otevřenou vědu",
    },
    paragraph: {
      en: "At Ersilia, I built full-stack tooling for scientific model metadata using Next.js and TypeScript, including database design and validated AI-assisted PDF processing.",
      cs: "V Ersilii jsem v Next.js a TypeScriptu vyvíjel fullstack nástroje pro metadata vědeckých modelů, včetně návrhu databáze a validovaného zpracování PDF s pomocí AI.",
    },
  },
  {
    id: "webintegrator",
    employer: "Web Integrator",
    domain: /agency|client|cms|content|agentur|klient/i,
    stack: /react|next|typescript|payload|accessib/i,
    label: {
      en: "React delivery and accessibility",
      cs: "Vývoj v Reactu a přístupnost",
    },
    paragraph: {
      en: "At Web Integrator, I lead frontend work in React, TypeScript, and Next.js, with responsibility for code quality, accessibility, and structured content.",
      cs: "Ve Web Integratoru vedu frontendový vývoj v Reactu, TypeScriptu a Next.js se zodpovědností za kvalitu kódu, přístupnost a strukturovaný obsah.",
    },
  },
  {
    id: "takeabreak",
    employer: "Take a Break",
    domain: /booking|wellness|meditation|reservation|rezervac/i,
    stack: /next|typescript|prisma|postgres|stripe|auth/i,
    label: {
      en: "Booking, payments and authentication",
      cs: "Rezervace, platby a autentizace",
    },
    paragraph: {
      en: "At Take a Break, I worked on a booking product with Next.js, TypeScript, PostgreSQL, and Prisma, including payments and authentication integrations.",
      cs: "V Take a Break jsem pracoval na rezervačním produktu v Next.js, TypeScriptu, PostgreSQL a Prismě, včetně integrace plateb a autentizace.",
    },
  },
];

export function suggestEvidence(description: string) {
  return CAREER_EVIDENCE.map((e) => ({
    evidence: e,
    domainMatch: e.domain.test(description),
    stackMatch: e.stack.test(description),
  }))
    .filter((e) => e.domainMatch || e.stackMatch)
    .sort(
      (a, b) =>
        Number(b.domainMatch) - Number(a.domainMatch) ||
        Number(b.stackMatch) - Number(a.stackMatch),
    );
}

export function buildLetter(input: {
  language: LetterLanguage;
  position: string;
  company: string;
  motivation: string;
  evidenceIds: string[];
  skills: string[];
}) {
  const { language: lang } = input;
  const position =
    input.position.trim() ||
    (lang === "cs" ? "nabízenou pozici" : "the advertised position");
  const company = input.company.trim();
  const intro =
    lang === "cs"
      ? `Dobrý den,\n\nrád bych se ucházel o pozici ${position}${company ? ` ve společnosti ${company}` : ""}.`
      : `Hello,\n\nI would like to apply for ${position}${company ? ` at ${company}` : ""}.`;
  const skills = input.skills.length
    ? lang === "cs"
      ? `Z technologií uvedených v nabídce mám zkušenosti s: ${input.skills.join(", ")}.`
      : `My experience includes these technologies from your posting: ${input.skills.join(", ")}.`
    : "";
  const evidence = input.evidenceIds
    .map((id) => CAREER_EVIDENCE.find((e) => e.id === id)?.paragraph[lang])
    .filter(Boolean);
  const end =
    lang === "cs"
      ? "Rád s vámi projdu konkrétní projekty a proberu, jak bych mohl přispět vašemu týmu.\n\nS pozdravem\nLukáš Kouřil\nhttps://lukaskouril.dev"
      : "I would be happy to walk you through relevant projects and discuss how I could contribute to your team.\n\nBest regards,\nLukáš Kouřil\nhttps://lukaskouril.dev";
  return [intro, input.motivation.trim(), skills, ...evidence, end]
    .filter(Boolean)
    .join("\n\n");
}
