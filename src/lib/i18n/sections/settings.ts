type SettingsStrings = {
  title: string;
  description: string;
  language: string;
  english: string;
  czech: string;
  currency: string;
  appearance: string;
  light: string;
  dark: string;
  navigation: string;
  navigationDesc: string;
  alwaysVisible: string;
  reorder: string;
  tasks: string;
  tasksAll: string;
  cv: string;
  cvDesc: string;
  cvCzech: string;
  cvEnglish: string;
  cvPlaceholder: string;
  resetNavigation: string;
  notifications: string;
  renewalNotifications: string;
  renewalNotificationsDesc: string;
  dataExport: string;
  dataExportDesc: string;
  exportFull: string;
  exportFinancial: string;
  exportProfessional: string;
  exportKnowledge: string;
  exportLegacy: string;
  exportProjects: string;
  exportNotes: string;
  exportPrompts: string;
  exportCareer: string;
  exportTransactionsCsv: string;
  integrations: string;
  integrationsDesc: string;
  bankProviderNote: string;
  connected: string;
  notConnected: string;
  configured: string;
  notConfigured: string;
  bankSync: string;
  emailDelivery: string;
  lastSync: string;
  activeProjects: string;
  activeProjectsDesc: string;
  activeProjectCount: (active: number, total: number) => string;
  showInactiveProjects: (n: number) => string;
  hideInactiveProjects: string;
  preferences: string;
  preferencesDesc: string;
  projectWithoutRepository: string;
  projectUpdateFailed: string;
  preferenceSaveFailed: string;
  preferenceSyncUnavailable: string;
  projectSections: string;
  projectSectionsDesc: string;
  engagementDesc: string;
  engagementFor: (project: string) => string;
  engagementSaving: string;
  engagementSaved: (project: string, engagement: "own" | "client") => string;
  engagementUpdateFailed: (project: string) => string;
  projectsLoading: string;
  projectsLoadFailed: string;
  noActiveProjects: string;
  noProjects: string;
};

export const settings: { en: SettingsStrings; cs: SettingsStrings } = {
  en: {
    title: "Settings",
    description: "Personalize your dashboard.",
    language: "Language",
    english: "English",
    czech: "Čeština",
    currency: "Display currency",
    appearance: "Appearance",
    light: "Light",
    dark: "Dark",
    navigation: "Navigation sections",
    navigationDesc:
      "Toggle which sections appear in navigation and drag to reorder within each group. Home and Inbox stay pinned.",
    alwaysVisible: "Always visible",
    reorder: "Drag to reorder",
    tasks: "Tasks",
    tasksAll: "All",
    cv: "CV links",
    cvDesc:
      "Google Docs links to your CVs — shown as buttons on the Career page. Paste the share URL; editing the doc keeps the same link.",
    cvCzech: "🇨🇿 Czech CV",
    cvEnglish: "🇬🇧 English CV",
    cvPlaceholder: "https://docs.google.com/document/d/…",
    resetNavigation: "Reset navigation",
    notifications: "Notifications",
    renewalNotifications: "Subscription renewal warnings",
    renewalNotificationsDesc: "Allow scheduled email warnings for active subscriptions renewing today or in three days.",
    dataExport: "Data & export",
    dataExportDesc: "Download portable JSON. Legacy personal data remains available after its source tables are removed.",
    exportFull: "Full export",
    exportFinancial: "Financial",
    exportProfessional: "Professional",
    exportKnowledge: "Knowledge",
    exportLegacy: "Legacy archive",
    exportProjects: "Projects",
    exportNotes: "Notes",
    exportPrompts: "Prompts",
    exportCareer: "Career",
    exportTransactionsCsv: "Transactions CSV",
    integrations: "Integrations",
    integrationsDesc: "Connection state only. Credentials and provider tokens are never exposed here.",
    bankProviderNote: "Bank sync can use more than one provider. A provider token you supply is stored server-side and read only while a sync runs.",
    connected: "Connected",
    notConnected: "Not connected",
    configured: "Configured",
    notConfigured: "Not configured",
    bankSync: "Bank sync",
    emailDelivery: "Email delivery",
    lastSync: "Last sync",
    activeProjects: "Active projects",
    activeProjectsDesc:
      "Only active GitHub projects appear in navigation, selectors, daily focus, and operational tables. This selection is synchronized between devices.",
    activeProjectCount: (active, total) => `${active} of ${total} active`,
    showInactiveProjects: (n) => `Show inactive (${n})`,
    hideInactiveProjects: "Hide inactive",
    preferences: "Preferences",
    preferencesDesc: "Language, appearance, currency, task density, and alerts.",
    projectWithoutRepository: "No GitHub repository linked",
    projectUpdateFailed: "Could not update the active project.",
    preferenceSaveFailed: "Could not synchronize this setting.",
    preferenceSyncUnavailable:
      "Database preference sync is unavailable. Local choices are preserved on this device; apply the latest Supabase migrations to restore cross-device sync.",
    projectSections: "Project workspace sections",
    projectSectionsDesc:
      "Choose which tabs appear inside every project workspace. Overview always stays visible.",
    engagementDesc:
      "Own or Freelance places an active project above or below the Freelance divider in the sidebar and in Projects.",
    engagementFor: (project) => `Own or Freelance: ${project}`,
    engagementSaving: "Saving…",
    engagementSaved: (project, engagement) =>
      engagement === "client"
        ? `${project} is now listed under Freelance.`
        : `${project} is now listed with your own projects.`,
    engagementUpdateFailed: (project) => `Could not move ${project}. It stays where it was.`,
    projectsLoading: "Loading projects…",
    projectsLoadFailed: "Could not load the projects. Reload the page to try again.",
    noActiveProjects: "No project is active. Show the inactive projects and turn one on to list it in the sidebar.",
    noProjects: "No projects yet. Add one in Projects.",
  },
  cs: {
    title: "Nastavení",
    description: "Přizpůsobte si svůj přehled.",
    language: "Jazyk",
    english: "English",
    czech: "Čeština",
    currency: "Zobrazená měna",
    appearance: "Vzhled",
    light: "Světlý",
    dark: "Tmavý",
    navigation: "Sekce navigace",
    navigationDesc:
      "Zapněte sekce navigace a přetažením změňte jejich pořadí ve skupině. Domů a Inbox zůstávají připnuté.",
    alwaysVisible: "Vždy viditelné",
    reorder: "Přetáhni pro změnu pořadí",
    tasks: "Úkoly",
    tasksAll: "Vše",
    cv: "Odkazy na CV",
    cvDesc:
      "Odkazy na tvoje životopisy v Google Docs — zobrazí se jako tlačítka na stránce Práce. Vlož sdílecí URL; úpravy dokumentu odkaz nemění.",
    cvCzech: "🇨🇿 České CV",
    cvEnglish: "🇬🇧 Anglické CV",
    cvPlaceholder: "https://docs.google.com/document/d/…",
    resetNavigation: "Obnovit navigaci",
    notifications: "Oznámení",
    renewalNotifications: "Upozornění na obnovení předplatného",
    renewalNotificationsDesc: "Povolte plánované e-mailové upozornění pro aktivní předplatná obnovovaná dnes nebo za tři dny.",
    dataExport: "Data a export",
    dataExportDesc: "Stáhněte přenositelný JSON. Starší osobní data zůstávají dostupná i po odstranění zdrojových tabulek.",
    exportFull: "Úplný export",
    exportFinancial: "Finance",
    exportProfessional: "Profesní",
    exportKnowledge: "Znalosti",
    exportLegacy: "Archiv starších dat",
    exportProjects: "Projekty",
    exportNotes: "Poznámky",
    exportPrompts: "Prompty",
    exportCareer: "Kariéra",
    exportTransactionsCsv: "Transakce CSV",
    integrations: "Integrace",
    integrationsDesc: "Zobrazuje se pouze stav připojení. Přihlašovací údaje ani tokeny poskytovatelů se zde nikdy neodhalují.",
    bankProviderNote: "Napojení banky může používat víc poskytovatelů. Token, který zadáš, se ukládá na serveru a čte se jen během synchronizace.",
    connected: "Připojeno",
    notConnected: "Nepřipojeno",
    configured: "Nakonfigurováno",
    notConfigured: "Nenakonfigurováno",
    bankSync: "Synchronizace banky",
    emailDelivery: "Doručování e-mailů",
    lastSync: "Poslední synchronizace",
    activeProjects: "Aktivní projekty",
    activeProjectsDesc:
      "V navigaci, selektorech, denním výběru a provozních tabulkách se zobrazují jen aktivní GitHub projekty. Výběr se synchronizuje mezi zařízeními.",
    activeProjectCount: (active, total) => `${active} z ${total} aktivních`,
    showInactiveProjects: (n) => `Zobrazit neaktivní (${n})`,
    hideInactiveProjects: "Skrýt neaktivní",
    preferences: "Předvolby",
    preferencesDesc: "Jazyk, vzhled, měna, hustota úkolů a upozornění.",
    projectWithoutRepository: "Bez napojeného GitHub repozitáře",
    projectUpdateFailed: "Aktivní projekt se nepodařilo změnit.",
    preferenceSaveFailed: "Toto nastavení se nepodařilo synchronizovat.",
    preferenceSyncUnavailable:
      "Databázová synchronizace nastavení není dostupná. Lokální volby na tomto zařízení zůstanou zachované; pro synchronizaci mezi zařízeními aplikuj nejnovější Supabase migrace.",
    projectSections: "Sekce projektového workspace",
    projectSectionsDesc:
      "Vyber, které záložky se zobrazí uvnitř každého projektu. Přehled zůstává vždy viditelný.",
    engagementDesc:
      "Vlastní nebo Freelance určuje, jestli se aktivní projekt v postranním panelu a v Projektech zobrazí nad oddělovačem Freelance, nebo pod ním.",
    engagementFor: (project) => `Vlastní nebo Freelance: ${project}`,
    engagementSaving: "Ukládám…",
    engagementSaved: (project, engagement) =>
      engagement === "client"
        ? `${project} je teď v sekci Freelance.`
        : `${project} je teď mezi vlastními projekty.`,
    engagementUpdateFailed: (project) => `${project} se nepodařilo přesunout. Zůstává, kde byl.`,
    projectsLoading: "Načítám projekty…",
    projectsLoadFailed: "Projekty se nepodařilo načíst. Zkuste stránku načíst znovu.",
    noActiveProjects: "Žádný projekt není aktivní. Zobrazte neaktivní projekty a zapněte ten, který chcete mít v postranním panelu.",
    noProjects: "Zatím tu nejsou žádné projekty. Přidejte je v Projektech.",
  },
};
