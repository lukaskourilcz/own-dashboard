type ProjectsStrings = {
  title: string;
  description: string;
  displayIn: string;

  // Grand totals across all active projects.
  grandTotalMonthly: string;
  grandTotalYearly: string;
  perMo: string;
  perYr: (yearly: string) => string;
  perMonth: string;
  perYear: string;
  activeProjects: (n: number) => string;
  allProjectsMonthly: string;

  // Project form.
  addProject: string;
  editProject: string;
  name: string;
  namePlaceholder: string;
  slug: string;
  slugPlaceholder: string;
  slugHint: string;
  repo: string;
  repoPlaceholder: string;
  url: string;
  urlPlaceholder: string;
  nameRequired: string;
  slugRequired: string;

  // Project card.
  active: string;
  inactive: string;
  markActive: string;
  markInactive: string;
  monthly: string;
  yearly: string;
  open: string;
  deleteProject: string;
  deleteProjectConfirm: string;

  // Costs.
  costs: string;
  addCost: string;
  costLabel: string;
  costLabelPlaceholder: string;
  amount: string;
  currency: string;
  costNotePlaceholder: string;
  noCosts: string;
  deleteCost: string;

  // Notes.
  notes: string;
  notesPlaceholder: string;
  saveNotes: string;
  notesSaved: string;
  saving: string;

  // Crons.
  crons: string;
  cronsHint: string;
  registryHint: (url: string) => string;
  addCron: string;
  editCron: string;
  cronName: string;
  cronNamePlaceholder: string;
  schedule: string;
  schedulePlaceholder: string;
  scheduleHint: string;
  endpoint: string;
  endpointPlaceholder: string;
  cronDescription: string;
  cronDescriptionPlaceholder: string;
  aiCall: string;
  aiCallHint: string;
  costPerRun: string;
  runsPerMonth: string;
  estMonthly: string;
  estMonthlyLabel: string;
  aiSpendMonthly: string;
  enabled: string;
  disabled: string;
  enable: string;
  disable: string;
  noCrons: string;
  deleteCron: string;
  deleteCronConfirm: string;
  lastRun: string;
  never: string;

  // Empty state.
  noProjects: string;
  addFirstProject: string;
};

export const projects: { en: ProjectsStrings; cs: ProjectsStrings } = {
  en: {
    title: "Projects",
    description:
      "Monthly running costs, notes and crons across your active projects.",
    displayIn: "Display in",

    grandTotalMonthly: "Total monthly",
    grandTotalYearly: "Total yearly",
    perMo: "/mo",
    perYr: (yearly) => `${yearly}/yr`,
    perMonth: "per month",
    perYear: "per year",
    activeProjects: (n) => `${n} active project${n === 1 ? "" : "s"}`,
    allProjectsMonthly: "Monthly cost by project",

    addProject: "Add project",
    editProject: "Edit project",
    name: "Name",
    namePlaceholder: "aifirst",
    slug: "Slug",
    slugPlaceholder: "aifirst",
    slugHint: "Stable handle used by the cron registry API.",
    repo: "Repository",
    repoPlaceholder: "owner/repo",
    url: "URL",
    urlPlaceholder: "https://…",
    nameRequired: "Name is required.",
    slugRequired: "Slug is required.",

    active: "active",
    inactive: "inactive",
    markActive: "Mark active",
    markInactive: "Mark inactive",
    monthly: "Monthly",
    yearly: "Yearly",
    open: "Open",
    deleteProject: "Delete project",
    deleteProjectConfirm:
      "Delete this project? Its costs and crons are removed too.",

    costs: "Costs",
    addCost: "Add cost",
    costLabel: "Label",
    costLabelPlaceholder: "Supabase",
    amount: "Amount",
    currency: "Currency",
    costNotePlaceholder: "note (optional)",
    noCosts: "No cost lines yet.",
    deleteCost: "Delete cost",

    notes: "Notes",
    notesPlaceholder: "Quick notes about this project…",
    saveNotes: "Save notes",
    notesSaved: "Saved",
    saving: "Saving…",

    crons: "Crons",
    cronsHint:
      "Scheduled jobs for this project. AI-API-call crons carry their cost.",
    registryHint: (url) => `The site can read the enabled set at ${url}`,
    addCron: "Add cron",
    editCron: "Edit cron",
    cronName: "Name",
    cronNamePlaceholder: "Daily article generation",
    schedule: "Schedule",
    schedulePlaceholder: "0 6 * * *",
    scheduleHint: "Standard 5-field cron expression.",
    endpoint: "Endpoint",
    endpointPlaceholder: "/api/cron/generate-daily",
    cronDescription: "Description",
    cronDescriptionPlaceholder: "What this cron does…",
    aiCall: "AI API call",
    aiCallHint: "Costs money per run",
    costPerRun: "Cost / run",
    runsPerMonth: "Runs / month",
    estMonthly: "Est. monthly",
    estMonthlyLabel: "est. monthly",
    aiSpendMonthly: "AI cron spend",
    enabled: "enabled",
    disabled: "disabled",
    enable: "Enable",
    disable: "Disable",
    noCrons: "No crons yet.",
    deleteCron: "Delete cron",
    deleteCronConfirm: "Delete this cron?",
    lastRun: "last run",
    never: "never",

    noProjects: "No projects yet",
    addFirstProject: "Add your first project using the form.",
  },
  cs: {
    title: "Projekty",
    description:
      "Měsíční provozní náklady, poznámky a crony aktivních projektů.",
    displayIn: "Zobrazit v",

    grandTotalMonthly: "Celkem měsíčně",
    grandTotalYearly: "Celkem ročně",
    perMo: "/měs",
    perYr: (yearly) => `${yearly}/rok`,
    perMonth: "měsíčně",
    perYear: "ročně",
    activeProjects: (n) =>
      `${n} aktivní${n === 1 ? " projekt" : n < 5 ? " projekty" : "ch projektů"}`,
    allProjectsMonthly: "Měsíční náklady podle projektu",

    addProject: "Přidat projekt",
    editProject: "Upravit projekt",
    name: "Název",
    namePlaceholder: "aifirst",
    slug: "Identifikátor",
    slugPlaceholder: "aifirst",
    slugHint: "Stabilní klíč používaný API registrem cronů.",
    repo: "Repozitář",
    repoPlaceholder: "owner/repo",
    url: "URL",
    urlPlaceholder: "https://…",
    nameRequired: "Název je povinný.",
    slugRequired: "Identifikátor je povinný.",

    active: "aktivní",
    inactive: "neaktivní",
    markActive: "Označit jako aktivní",
    markInactive: "Označit jako neaktivní",
    monthly: "Měsíčně",
    yearly: "Ročně",
    open: "Otevřít",
    deleteProject: "Smazat projekt",
    deleteProjectConfirm:
      "Smazat tento projekt? Odstraní se i jeho náklady a crony.",

    costs: "Náklady",
    addCost: "Přidat náklad",
    costLabel: "Popis",
    costLabelPlaceholder: "Supabase",
    amount: "Částka",
    currency: "Měna",
    costNotePlaceholder: "poznámka (volitelné)",
    noCosts: "Zatím žádné položky nákladů.",
    deleteCost: "Smazat náklad",

    notes: "Poznámky",
    notesPlaceholder: "Rychlé poznámky k projektu…",
    saveNotes: "Uložit poznámky",
    notesSaved: "Uloženo",
    saving: "Ukládám…",

    crons: "Crony",
    cronsHint:
      "Naplánované úlohy projektu. Crony s voláním AI API nesou svoje náklady.",
    registryHint: (url) => `Stránka může načíst povolené crony na ${url}`,
    addCron: "Přidat cron",
    editCron: "Upravit cron",
    cronName: "Název",
    cronNamePlaceholder: "Denní generování článku",
    schedule: "Plán",
    schedulePlaceholder: "0 6 * * *",
    scheduleHint: "Standardní pětipolní cron výraz.",
    endpoint: "Endpoint",
    endpointPlaceholder: "/api/cron/generate-daily",
    cronDescription: "Popis",
    cronDescriptionPlaceholder: "Co tento cron dělá…",
    aiCall: "Volání AI API",
    aiCallHint: "Stojí peníze za každé spuštění",
    costPerRun: "Cena / spuštění",
    runsPerMonth: "Spuštění / měsíc",
    estMonthly: "Odhad měsíčně",
    estMonthlyLabel: "odhad měsíčně",
    aiSpendMonthly: "Náklady AI cronů",
    enabled: "povoleno",
    disabled: "zakázáno",
    enable: "Povolit",
    disable: "Zakázat",
    noCrons: "Zatím žádné crony.",
    deleteCron: "Smazat cron",
    deleteCronConfirm: "Smazat tento cron?",
    lastRun: "poslední běh",
    never: "nikdy",

    noProjects: "Zatím žádné projekty",
    addFirstProject: "Přidejte první projekt pomocí formuláře.",
  },
};
