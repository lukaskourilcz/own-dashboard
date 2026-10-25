type PortfolioStrings = {
  subsection: string;
  subsectionOf: (parent: string) => string;
  competitionTitle: string;
  competitionDescription: string;
  addCompetitor: string;
  editCompetitor: string;
  deleteCompetitor: string;
  deleteCompetitorConfirm: string;
  noCompetitors: string;
  noCompetitorsHint: string;
  noCompetitorsForProject: string;
  competitorName: string;
  competitorUrl: string;
  competitorSummary: string;
  competitorCategory: string;
  categories: { direct: string; indirect: string; inspiration: string };
  usefulFeatures: string;
  usefulFeaturesHint: string;
  socialContent: string;
  pricingModel: string;
  lessons: string;
  relevanceScore: string;
  scoreRationale: string;
  socialLinks: string;
  sourceUrls: string;
  oneUrlPerLine: string;
  reviewedAt: string;
  reviewStale: string;
  reviewNever: string;
  reviewStaleHint: string;
  reviewFilter: string;
  allReviews: string;
  staleOnly: string;
  staleCount: (n: number) => string;
  project: string;
  allProjects: string;
  allCategories: string;
  searchCompetitors: string;
  competitorsCount: (n: number) => string;
  nameAndProjectRequired: string;
  competitorPages: string;
  competitorPageRange: (from: number, to: number, total: number) => string;
  competitorPrevious: string;
  competitorNext: string;
  competitorNoMatches: string;
  competitorNoMatchesHint: string;
  competitorClearFilters: string;
  competitorProjectUnavailable: string;
  competitorNameInvalid: string;
  competitorUrlInvalid: string;
  competitorSaveUnconfirmed: string;
  competitorActionUnconfirmed: string;
  competitorChanged: string;
  competitorReload: string;
  competitorReadUnavailable: string;
  notScored: string;
  projectCompetitionTab: string;
  visit: string;
  finance: {
    title: string;
    description: string;
    recurringMonthly: string;
    recurringYearly: string;
    paidLastMonths: (n: number) => string;
    ownShare: string;
    clientShare: string;
    unallocated: string;
    unallocatedHint: string;
    timelineTitle: string;
    timelineHint: string;
    committed: string;
    paid: string;
    byProjectTitle: string;
    byVendorTitle: string;
    projectDetails: string;
    subscriptionDetails: string;
    notStarted: string;
    projectColumn: string;
    monthlyColumn: string;
    yearlyColumn: string;
    oneOffColumn: string;
    paidColumn: string;
    shareColumn: string;
    vendorColumn: string;
    planColumn: string;
    amountColumn: string;
    startedColumn: string;
    nextColumn: string;
    allocationColumn: string;
    noDevSpend: string;
    noDevSpendHint: string;
    recentTransactions: string;
    noRecentTransactions: string;
    running: string;
    ended: string;
    manageSubscriptions: string;
    settles: (name: string) => string;
    allocationsHint: string;
    unallocatedShort: string;
    manualCosts: string;
    amountConfirmed: (date: string) => string;
    amountUnconfirmed: string;
    confirmAmount: string;
    unconfirmAmount: string;
    unconfirmedAmounts: (amount: string, count: number) => string;
    unconfirmedAmountsHint: string;
  };
  subscription: {
    startedOn: string;
    endedOn: string;
    plan: string;
    planPlaceholder: string;
    vendorUrl: string;
    notes: string;
    notesPlaceholder: string;
    allocations: string;
    allocationsHint: string;
    addAllocation: string;
    removeAllocation: string;
    share: string;
    allocated: (percent: number) => string;
    overAllocated: string;
    quarterly: string;
    lifecycle: (started: string, ended: string | null) => string;
    confirmationResets: string;
    allocationsSaveFailed: string;
  };
};

export const portfolio: { en: PortfolioStrings; cs: PortfolioStrings } = {
  en: {
    subsection: "Subsection",
    subsectionOf: (parent) => `Part of ${parent}`,
    competitionTitle: "Competition",
    competitionDescription: "Competitor research by project: features, pricing, social content and lessons.",
    addCompetitor: "Add competitor",
    editCompetitor: "Edit competitor",
    deleteCompetitor: "Delete competitor",
    deleteCompetitorConfirm: "Delete this competitor and its research notes?",
    noCompetitors: "No competitors recorded yet",
    noCompetitorsHint: "Add the products you keep comparing against. Each entry belongs to one project.",
    noCompetitorsForProject: "No competitors recorded for this project.",
    competitorName: "Name",
    competitorUrl: "Website",
    competitorSummary: "What it is",
    competitorCategory: "Type",
    categories: { direct: "Direct", indirect: "Indirect", inspiration: "Inspiration" },
    usefulFeatures: "Most useful features",
    usefulFeaturesHint: "One feature per line.",
    socialContent: "Social media content",
    pricingModel: "Pricing model",
    lessons: "What to learn from it",
    relevanceScore: "Relevance",
    scoreRationale: "Why this score",
    socialLinks: "Social profiles",
    sourceUrls: "Sources",
    oneUrlPerLine: "One URL per line.",
    reviewedAt: "Reviewed on",
    reviewStale: "Needs refresh",
    reviewNever: "Never reviewed",
    reviewStaleHint: "Marked when the last review is 90 days old or older. Open the competitor, check what changed and save a new review date.",
    reviewFilter: "Review",
    allReviews: "Any review date",
    staleOnly: "Needs refresh",
    staleCount: (n) => `${n} ${n === 1 ? "needs a refresh" : "need a refresh"}`,
    project: "Project",
    allProjects: "All projects",
    allCategories: "All types",
    searchCompetitors: "Search competitors…",
    competitorsCount: (n) => `${n} ${n === 1 ? "competitor" : "competitors"}`,
    nameAndProjectRequired: "A name and a project are required.",
    competitorPages: "Competition pages",
    competitorPrevious: "Previous",
    competitorNext: "Next",
    competitorNoMatches: "No matching competitors",
    competitorNoMatchesHint: "Try a different search or clear the filters.",
    competitorClearFilters: "Clear filters",
    competitorProjectUnavailable: "Project unavailable",
    competitorPageRange: (from, to, total) => `${from}–${to} of ${total}`,
    competitorNameInvalid: "Enter a name up to 120 characters.",
    competitorUrlInvalid: "Use HTTP or HTTPS addresses without sign-in details, up to 2,000 characters each.",
    competitorSaveUnconfirmed: "The save could not be confirmed. Your draft is kept. Try saving again.",
    competitorActionUnconfirmed: "The change could not be confirmed. Reload the list before trying again.",
    competitorChanged: "This entry changed or is no longer available. Copy any draft changes before closing and reloading the list.",
    competitorReload: "Reload competition",
    competitorReadUnavailable: "Competition could not be refreshed. Last confirmed data may be out of date.",
    notScored: "Not scored",
    projectCompetitionTab: "Competition",
    visit: "Visit",
    finance: {
      title: "Development finance",
      description: "What building and running the projects costs: AI tools, hosting, data services and design tooling. Personal spend stays out.",
      recurringMonthly: "Recurring per month",
      recurringYearly: "Recurring per year",
      paidLastMonths: (n) => `Paid in the last ${n} months`,
      ownShare: "Own projects",
      clientShare: "Client work",
      unallocated: "Unallocated",
      unallocatedHint: "Shared subscriptions without a project split. Allocate them in Subscriptions to move this amount onto projects.",
      timelineTitle: "Monthly development spend",
      timelineHint: "Committed estimates past months using today's subscription prices and recorded activity dates; manual project costs are excluded. Paid includes transactions dated through today.",
      committed: "Committed",
      paid: "Paid",
      byProjectTitle: "By project",
      byVendorTitle: "By vendor",
      projectDetails: "Project allocations",
      subscriptionDetails: "Subscription details",
      notStarted: "Not started",
      projectColumn: "Project",
      monthlyColumn: "Monthly",
      yearlyColumn: "Yearly",
      oneOffColumn: "One-off (12 mo)",
      paidColumn: "Paid (12 mo)",
      shareColumn: "Share",
      vendorColumn: "Vendor",
      planColumn: "Plan",
      amountColumn: "Amount",
      startedColumn: "Since",
      nextColumn: "Next billing",
      allocationColumn: "Allocated to",
      noDevSpend: "No development spend recorded",
      noDevSpendHint: "Mark a subscription's group as Development or allocate it to a project, and link paid invoices as transactions.",
      recentTransactions: "Development payments",
      noRecentTransactions: "No development payments in this window.",
      running: "Running",
      ended: "Ended",
      manageSubscriptions: "Manage subscriptions",
      settles: (name) => `Settles ${name}`,
      allocationsHint: "An explicit transaction project takes precedence. Other subscription payments use the current shares, not a historical allocation ledger.",
      unallocatedShort: "Unallocated",
      manualCosts: "Manual cost lines and automations",
      amountConfirmed: (date) => `Amount confirmed ${date}`,
      amountUnconfirmed: "Amount not confirmed",
      confirmAmount: "Confirm the amount against the invoice",
      unconfirmAmount: "Mark the amount as not confirmed",
      unconfirmedAmounts: (amount, count) =>
        `${amount} per month across ${count} ${count === 1 ? "subscription" : "subscriptions"} whose amount has not been checked against an invoice.`,
      unconfirmedAmountsHint:
        "An amount taken from a renewal notice or a price change is an estimate until somebody opens the invoice. Confirm it in Subscriptions; changing the figure later clears the confirmation.",
    },
    subscription: {
      startedOn: "Started on",
      endedOn: "Ended on",
      plan: "Plan",
      planPlaceholder: "Pro, Max 20x, Starter…",
      vendorUrl: "Billing page",
      notes: "Notes",
      notesPlaceholder: "Invoice numbers, payment issues, what it is used for…",
      allocations: "Project allocation",
      allocationsHint: "Split the monthly amount across projects. Whatever is left stays unallocated.",
      addAllocation: "Add project share",
      removeAllocation: "Remove share",
      share: "Share %",
      allocated: (percent) => `${percent}% allocated`,
      overAllocated: "Shares add up to more than 100%.",
      quarterly: "Quarterly",
      lifecycle: (started, ended) => (ended ? `${started} – ${ended}` : `since ${started}`),
      confirmationResets: "Changing the amount, currency or billing cycle clears the confirmation.",
      allocationsSaveFailed: "Subscription saved. Project allocations could not be confirmed; review them before saving again. This form now updates the saved subscription.",
    },
  },
  cs: {
    subsection: "Podsekce",
    subsectionOf: (parent) => `Součást ${parent}`,
    competitionTitle: "Konkurence",
    competitionDescription: "Průzkum konkurence podle projektů: funkce, ceny, obsah na sítích a poučení.",
    addCompetitor: "Přidat konkurenta",
    editCompetitor: "Upravit konkurenta",
    deleteCompetitor: "Smazat konkurenta",
    deleteCompetitorConfirm: "Smazat tohoto konkurenta včetně poznámek z rešerše?",
    noCompetitors: "Zatím žádní konkurenti",
    noCompetitorsHint: "Přidejte produkty, se kterými se porovnáváte. Každý záznam patří jednomu projektu.",
    noCompetitorsForProject: "U tohoto projektu nejsou zaznamenaní žádní konkurenti.",
    competitorName: "Název",
    competitorUrl: "Web",
    competitorSummary: "Co to je",
    competitorCategory: "Typ",
    categories: { direct: "Přímý", indirect: "Nepřímý", inspiration: "Inspirace" },
    usefulFeatures: "Nejužitečnější funkce",
    usefulFeaturesHint: "Jedna funkce na řádek.",
    socialContent: "Obsah na sociálních sítích",
    pricingModel: "Cenový model",
    lessons: "Co se z toho naučit",
    relevanceScore: "Relevance",
    scoreRationale: "Proč toto hodnocení",
    socialLinks: "Sociální profily",
    sourceUrls: "Zdroje",
    oneUrlPerLine: "Jedna URL na řádek.",
    reviewedAt: "Ověřeno dne",
    reviewStale: "K ověření",
    reviewNever: "Neověřeno",
    reviewStaleHint: "Označí se, když je poslední ověření staré 90 dní a víc. Otevřete konkurenta, zkontrolujte, co se změnilo, a uložte nové datum ověření.",
    reviewFilter: "Ověření",
    allReviews: "Jakékoli ověření",
    staleOnly: "K ověření",
    staleCount: (n) => `${n} ${n === 1 ? "čeká na ověření" : n < 5 ? "čekají na ověření" : "čeká na ověření"}`,
    project: "Projekt",
    allProjects: "Všechny projekty",
    allCategories: "Všechny typy",
    searchCompetitors: "Hledat konkurenty…",
    competitorsCount: (n) => `${n} ${n === 1 ? "konkurent" : n < 5 ? "konkurenti" : "konkurentů"}`,
    nameAndProjectRequired: "Název a projekt jsou povinné.",
    competitorPages: "Stránky konkurence",
    competitorPrevious: "Předchozí",
    competitorNext: "Další",
    competitorNoMatches: "Žádní odpovídající konkurenti",
    competitorNoMatchesHint: "Zkuste jiné hledání nebo zrušte filtry.",
    competitorClearFilters: "Zrušit filtry",
    competitorProjectUnavailable: "Projekt není dostupný",
    competitorPageRange: (from, to, total) => `${from}–${to} z ${total}`,
    competitorNameInvalid: "Zadejte název o délce nejvýše 120 znaků.",
    competitorUrlInvalid: "Použijte adresy HTTP nebo HTTPS bez přihlašovacích údajů, každou nejvýše o 2 000 znacích.",
    competitorSaveUnconfirmed: "Uložení se nepodařilo potvrdit. Koncept zůstává zachovaný. Zkuste ho uložit znovu.",
    competitorActionUnconfirmed: "Změnu se nepodařilo potvrdit. Před dalším pokusem znovu načtěte seznam.",
    competitorChanged: "Záznam se změnil nebo už není dostupný. Před zavřením a novým načtením seznamu si zkopírujte změny z konceptu.",
    competitorReload: "Načíst konkurenci znovu",
    competitorReadUnavailable: "Konkurenci se nepodařilo obnovit. Poslední potvrzené údaje mohou být zastaralé.",
    notScored: "Bez hodnocení",
    projectCompetitionTab: "Konkurence",
    visit: "Otevřít",
    finance: {
      title: "Finance vývoje",
      description: "Kolik stojí stavba a provoz projektů: AI nástroje, hosting, datové služby a designové nástroje. Osobní výdaje sem nepatří.",
      recurringMonthly: "Opakované měsíčně",
      recurringYearly: "Opakované ročně",
      paidLastMonths: (n) => `Zaplaceno za posledních ${n} měsíců`,
      ownShare: "Vlastní projekty",
      clientShare: "Klientská práce",
      unallocated: "Nepřiřazeno",
      unallocatedHint: "Sdílená předplatná bez rozdělení na projekty. Rozdělte je v Předplatných, aby se částka přesunula na projekty.",
      timelineTitle: "Měsíční výdaje na vývoj",
      timelineHint: "Závazky odhadují minulá období z dnešních cen předplatných a zadaných dat aktivity; ruční náklady projektů nezahrnují. Zaplaceno zahrnuje transakce s datem nejpozději dnes.",
      committed: "Závazky",
      paid: "Zaplaceno",
      byProjectTitle: "Podle projektu",
      byVendorTitle: "Podle dodavatele",
      projectDetails: "Přiřazení k projektům",
      subscriptionDetails: "Podrobnosti předplatných",
      notStarted: "Ještě nezačalo",
      projectColumn: "Projekt",
      monthlyColumn: "Měsíčně",
      yearlyColumn: "Ročně",
      oneOffColumn: "Jednorázově (12 měs.)",
      paidColumn: "Zaplaceno (12 měs.)",
      shareColumn: "Podíl",
      vendorColumn: "Dodavatel",
      planColumn: "Plán",
      amountColumn: "Částka",
      startedColumn: "Od",
      nextColumn: "Další platba",
      allocationColumn: "Přiřazeno",
      noDevSpend: "Žádné výdaje na vývoj",
      noDevSpendHint: "Označte skupinu předplatného jako Vývoj nebo ho přiřaďte projektu a zaplacené faktury zapište jako transakce.",
      recentTransactions: "Platby za vývoj",
      noRecentTransactions: "V tomto období nejsou žádné platby za vývoj.",
      running: "Běží",
      ended: "Ukončeno",
      manageSubscriptions: "Spravovat předplatná",
      settles: (name) => `Hradí ${name}`,
      allocationsHint: "Výslovné přiřazení transakce k projektu má přednost. Ostatní platby předplatných používají aktuální podíly, nikoli historickou evidenci přiřazení.",
      unallocatedShort: "Nepřiřazeno",
      manualCosts: "Ruční nákladové položky a automatizace",
      amountConfirmed: (date) => `Částka ověřena ${date}`,
      amountUnconfirmed: "Částka neověřena",
      confirmAmount: "Ověřit částku proti faktuře",
      unconfirmAmount: "Označit částku jako neověřenou",
      unconfirmedAmounts: (amount, count) =>
        `${amount} měsíčně u ${count} ${count === 1 ? "předplatného" : "předplatných"}, kde částka nebyla porovnána s fakturou.`,
      unconfirmedAmountsHint:
        "Částka převzatá z oznámení o obnovení nebo ze změny ceny je odhad, dokud se neotevře faktura. Ověřte ji v Předplatných; pozdější změna částky ověření zruší.",
    },
    subscription: {
      startedOn: "Začátek",
      endedOn: "Konec",
      plan: "Plán",
      planPlaceholder: "Pro, Max 20x, Starter…",
      vendorUrl: "Stránka fakturace",
      notes: "Poznámky",
      notesPlaceholder: "Čísla faktur, problémy s platbou, k čemu se používá…",
      allocations: "Rozdělení na projekty",
      allocationsHint: "Rozdělte měsíční částku mezi projekty. Zbytek zůstane nepřiřazený.",
      addAllocation: "Přidat podíl projektu",
      removeAllocation: "Odebrat podíl",
      share: "Podíl %",
      allocated: (percent) => `přiřazeno ${percent} %`,
      overAllocated: "Podíly dávají dohromady víc než 100 %.",
      quarterly: "Čtvrtletně",
      lifecycle: (started, ended) => (ended ? `${started} – ${ended}` : `od ${started}`),
      confirmationResets: "Změna částky, měny nebo fakturačního období ověření zruší.",
      allocationsSaveFailed: "Předplatné je uložené. Rozdělení mezi projekty nebylo potvrzeno; před dalším uložením je zkontrolujte. Formulář nyní upravuje uložené předplatné.",
    },
  },
};
