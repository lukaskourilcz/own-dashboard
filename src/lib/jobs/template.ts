// Cover-letter template plumbing: {{placeholder}} substitution plus the
// built-in starter templates offered alongside the user's own saved ones.

export type TemplateVars = {
  position?: string | null;
  company?: string | null;
  source?: string | null;
  /** Preformatted date string; defaults are the caller's concern. */
  date?: string | null;
};

// Neutral fallbacks so a letter never renders "at ." when a job card is
// missing a field.
const FALLBACKS: Record<keyof TemplateVars, string> = {
  position: "this position",
  company: "your company",
  source: "your job posting",
  date: "",
};

/**
 * Replace {{position}} / {{company}} / {{source}} / {{date}} in a template
 * body. Placeholder names are case-insensitive and tolerate inner
 * whitespace ("{{ Company }}"). Unknown placeholders are left untouched so
 * a typo stays visible instead of silently vanishing.
 */
export function fillTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (raw, name: string) => {
    const key = name.toLowerCase() as keyof TemplateVars;
    if (!(key in FALLBACKS)) return raw;
    const value = vars[key];
    return value && value.trim() ? value.trim() : FALLBACKS[key];
  });
}

export type BuiltinTemplate = {
  id: string;
  name: { en: string; cs: string };
  body: { en: string; cs: string };
};

// Three starting points covering the usual registers. Kept deliberately
// short — a cover letter the user doesn't rewrite is a bad cover letter.
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "classic",
    name: { en: "Classic professional", cs: "Klasický profesionální" },
    body: {
      en: `Dear Hiring Manager,

I am writing to apply for the {{position}} role at {{company}}, which I found via {{source}}.

Over the past years I have built and shipped production web applications, with a focus on clean architecture, performance, and developer experience. I enjoy owning features end to end — from design discussions through implementation to monitoring in production.

I would welcome the chance to talk about how my experience maps to your team's needs. Thank you for your time and consideration.

Best regards,`,
      cs: `Dobrý den,

reaguji na pozici {{position}} ve společnosti {{company}}, kterou jsem našel přes {{source}}.

V posledních letech jsem navrhoval a dodával produkční webové aplikace s důrazem na čistou architekturu, výkon a developer experience. Rád přebírám odpovědnost za funkce od návrhu přes implementaci až po provoz v produkci.

Rád si promluvím o tom, jak mé zkušenosti odpovídají potřebám vašeho týmu. Děkuji za váš čas.

S pozdravem,`,
    },
  },
  {
    id: "short",
    name: { en: "Short & direct", cs: "Krátký a přímý" },
    body: {
      en: `Hi,

I'd like to apply for the {{position}} role at {{company}}.

Three things about me:
- I ship: recent projects went from idea to production with me owning the full stack.
- I care about the craft: typed code, tests where they pay off, honest code reviews.
- I work well remotely: async-first communication and clear written updates.

Happy to share code samples or walk through past work. Looking forward to hearing from you.`,
      cs: `Dobrý den,

rád bych se ucházel o pozici {{position}} ve společnosti {{company}}.

Tři věci o mně:
- Dotahuji věci: poslední projekty šly od nápadu do produkce s mojí plnou odpovědností.
- Záleží mi na řemesle: typovaný kód, testy tam, kde se vyplatí, poctivé code review.
- Remote práce mi sedí: async komunikace a jasné písemné updaty.

Rád ukážu ukázky kódu nebo projdu předchozí práci. Těším se na odpověď.`,
    },
  },
  {
    id: "startup",
    name: { en: "Enthusiastic startup", cs: "Nadšený startupový" },
    body: {
      en: `Hi team,

The {{position}} opening at {{company}} caught my attention on {{source}} — what you're building is exactly the kind of product I want to work on.

I move fast without breaking things: small PRs, feature flags, and measuring before and after. I'm comfortable wearing multiple hats — frontend polish one day, API design or infra tweaks the next.

I'd love to show you what I could contribute in the first 90 days. Can we talk?`,
      cs: `Ahoj,

pozice {{position}} ve firmě {{company}} mě zaujala na {{source}} — to, co stavíte, je přesně ten typ produktu, na kterém chci pracovat.

Umím se hýbat rychle a nic přitom nerozbít: malé PR, feature flagy a měření před i po. Nevadí mi střídat role — jeden den ladění frontendu, druhý den návrh API nebo úprava infrastruktury.

Rád vám ukážu, co můžu přinést v prvních 90 dnech. Ozvete se?`,
    },
  },
];
