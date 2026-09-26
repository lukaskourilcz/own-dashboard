type ProjectsStrings = {
  title: string;
  description: string;
  displayIn: string;
  newProjectGuide: string;

  // Grand totals across all active projects.
  grandTotalMonthly: string;
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
  devUrl: string;
  devUrlPlaceholder: string;
  engagement: string;
  engagementOwn: string;
  engagementClient: string;
  freelanceDivider: string;
  nameRequired: string;
  slugRequired: string;

  // Project card.
  active: string;
  inactive: string;
  synced: string;
  syncedHint: string;
  collapse: string;
  expand: string;
  dragHandle: string;
  markActive: string;
  markInactive: string;
  monthly: string;
  yearly: string;
  open: string;
  deleteProject: string;
  deleteProjectConfirm: string;
  tableProject: string;
  tableClient: string;
  tableHealth: string;
  tableRepository: string;
  tableMonthlyCost: string;
  tableTasks: string;
  tableNextDate: string;
  tableActions: string;
  workspace: string;
  development: string;
  manage: string;

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
  registryHint: (url: string) => string;
  addCron: string;
  cronName: string;
  cronNamePlaceholder: string;
  schedule: string;
  schedulePlaceholder: string;
  endpoint: string;
  endpointPlaceholder: string;
  cronDescription: string;
  cronDescriptionPlaceholder: string;
  aiCall: string;
  aiCallHint: string;
  costPerRun: string;
  runsPerMonth: string;
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

  // Heartbeat monitoring.
  heartbeatUrl: string;
  heartbeatUrlPlaceholder: string;
  heartbeatHint: string;
  heartbeatOk: string;
  heartbeatLate: string;
  heartbeatStale: string;
  heartbeatNever: string;
  heartbeatUnmonitored: string;
  heartbeatLastSuccess: (when: string) => string;
  heartbeatNoSuccess: string;
  heartbeatUnmonitoredHint: string;

  // Empty state.
  noProjects: string;
  addFirstProject: string;
};

export const projects: { en: ProjectsStrings; cs: ProjectsStrings } = {
  en: {
    newProjectGuide: "New project guide — standards for wiring a repo into OwnDashboard",
    title: "Projects",
    description:
      "Monthly running costs, notes and crons across your active projects. Active repositories show up here automatically.",
    displayIn: "Display in",

    grandTotalMonthly: "Total monthly",
    perMo: "/mo",
    perYr: (yearly) => `${yearly}/yr`,
    perMonth: "per month",
    perYear: "per year",
    activeProjects: (n) => `${n} active project${n === 1 ? "" : "s"}`,
    allProjectsMonthly: "Monthly cost by project",

    addProject: "Add project",
    editProject: "Edit project",
    name: "Name",
    namePlaceholder: "DNESKAi",
    slug: "Slug",
    slugPlaceholder: "dneskai",
    slugHint: "Stable handle used by the cron registry API.",
    repo: "Repository",
    repoPlaceholder: "owner/repo",
    url: "URL",
    urlPlaceholder: "https://…",
    devUrl: "Development URL",
    devUrlPlaceholder: "https://dev.example.com or http://localhost:3000",
    engagement: "Engagement",
    engagementOwn: "Own",
    engagementClient: "Freelance",
    freelanceDivider: "Freelance",
    nameRequired: "Name is required.",
    slugRequired: "Slug is required.",

    active: "active",
    inactive: "inactive",
    synced: "Repository",
    syncedHint: "Synced automatically from its linked GitHub repository.",
    collapse: "Collapse",
    expand: "Expand",
    dragHandle: "Drag to reorder",
    markActive: "Mark active",
    markInactive: "Mark inactive",
    monthly: "Monthly",
    yearly: "Yearly",
    open: "Open",
    deleteProject: "Delete project",
    deleteProjectConfirm:
      "Delete this project? Its costs and crons are removed too.",
    tableProject: "Project",
    tableClient: "Client",
    tableHealth: "Health",
    tableRepository: "Repository",
    tableMonthlyCost: "Monthly cost",
    tableTasks: "Open tasks",
    tableNextDate: "Next date",
    tableActions: "Actions",
    workspace: "Workspace",
    development: "Dev",
    manage: "Manage operations",

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
    registryHint: (url) =>
      `External sites can read the enabled set at ${url} with the CRON_REGISTRY_TOKEN bearer token.`,
    addCron: "Add cron",
    cronName: "Name",
    cronNamePlaceholder: "Daily article generation",
    schedule: "Schedule",
    schedulePlaceholder: "0 6 * * *",
    endpoint: "Endpoint",
    endpointPlaceholder: "/api/cron/generate-daily",
    cronDescription: "Description",
    cronDescriptionPlaceholder: "What this cron does…",
    aiCall: "AI API call",
    aiCallHint: "Costs money per run",
    costPerRun: "Cost / run",
    runsPerMonth: "Runs / month",
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

    heartbeatUrl: "Heartbeat URL",
    heartbeatUrlPlaceholder: "https://uptime.example.com/api/push/aBc123",
    heartbeatHint:
      "Push-monitor URL, called only after a successful run. Leave empty to leave this cron unmonitored.",
    heartbeatOk: "On time",
    heartbeatLate: "Late",
    heartbeatStale: "Not reporting",
    heartbeatNever: "No run yet",
    heartbeatUnmonitored: "Unmonitored",
    heartbeatLastSuccess: (when) => `Last success ${when}`,
    heartbeatNoSuccess: "No successful run recorded yet.",
    heartbeatUnmonitoredHint:
      "Add a heartbeat URL to be told when this cron stops running.",

    noProjects: "No projects yet",
    addFirstProject: "Add your first project using the form.",
  },
  cs: {
    newProjectGuide: "Návod pro nový projekt — standardy pro napojení repozitáře na OwnDashboard",
    title: "Projekty",
    description:
      "Měsíční provozní náklady, poznámky a crony aktivních projektů. Aktivní repozitáře se sem přidají automaticky.",
    displayIn: "Zobrazit v",

    grandTotalMonthly: "Celkem měsíčně",
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
    namePlaceholder: "DNESKAi",
    slug: "Identifikátor",
    slugPlaceholder: "dneskai",
    slugHint: "Stabilní klíč používaný API registrem cronů.",
    repo: "Repozitář",
    repoPlaceholder: "owner/repo",
    url: "URL",
    urlPlaceholder: "https://…",
    devUrl: "Vývojová URL",
    devUrlPlaceholder: "https://dev.example.com nebo http://localhost:3000",
    engagement: "Typ spolupráce",
    engagementOwn: "Vlastní",
    engagementClient: "Freelance",
    freelanceDivider: "Freelance",
    nameRequired: "Název je povinný.",
    slugRequired: "Identifikátor je povinný.",

    active: "aktivní",
    inactive: "neaktivní",
    synced: "Repozitář",
    syncedHint:
      "Automaticky synchronizováno z propojeného GitHub repozitáře.",
    collapse: "Sbalit",
    expand: "Rozbalit",
    dragHandle: "Přetáhni pro změnu pořadí",
    markActive: "Označit jako aktivní",
    markInactive: "Označit jako neaktivní",
    monthly: "Měsíčně",
    yearly: "Ročně",
    open: "Otevřít",
    deleteProject: "Smazat projekt",
    deleteProjectConfirm:
      "Smazat tento projekt? Odstraní se i jeho náklady a crony.",
    tableProject: "Projekt",
    tableClient: "Klient",
    tableHealth: "Stav",
    tableRepository: "Repozitář",
    tableMonthlyCost: "Měsíční náklady",
    tableTasks: "Otevřené úkoly",
    tableNextDate: "Příští termín",
    tableActions: "Akce",
    workspace: "Workspace",
    development: "Dev",
    manage: "Spravovat provoz",

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
    registryHint: (url) =>
      `Externí weby mohou povolené crony načíst na ${url} s bearer tokenem CRON_REGISTRY_TOKEN.`,
    addCron: "Přidat cron",
    cronName: "Název",
    cronNamePlaceholder: "Denní generování článku",
    schedule: "Plán",
    schedulePlaceholder: "0 6 * * *",
    endpoint: "Endpoint",
    endpointPlaceholder: "/api/cron/generate-daily",
    cronDescription: "Popis",
    cronDescriptionPlaceholder: "Co tento cron dělá…",
    aiCall: "Volání AI API",
    aiCallHint: "Stojí peníze za každé spuštění",
    costPerRun: "Cena / spuštění",
    runsPerMonth: "Spuštění / měsíc",
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

    heartbeatUrl: "URL pro heartbeat",
    heartbeatUrlPlaceholder: "https://uptime.example.com/api/push/aBc123",
    heartbeatHint:
      "Adresa push monitoru, volá se až po úspěšném běhu. Prázdné pole znamená, že cron nikdo nehlídá.",
    heartbeatOk: "Včas",
    heartbeatLate: "Zpoždění",
    heartbeatStale: "Nehlásí se",
    heartbeatNever: "Zatím bez běhu",
    heartbeatUnmonitored: "Bez hlídání",
    heartbeatLastSuccess: (when) => `Poslední úspěch ${when}`,
    heartbeatNoSuccess: "Zatím není zaznamenaný žádný úspěšný běh.",
    heartbeatUnmonitoredHint:
      "Doplňte adresu heartbeatu, ať se dozvíte, že cron přestal běhat.",

    noProjects: "Zatím žádné projekty",
    addFirstProject: "Přidejte první projekt pomocí formuláře.",
  },
};
