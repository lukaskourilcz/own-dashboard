type SettingsStrings = {
  title: string;
  description: string;
  language: string;
  languageDesc: string;
  english: string;
  czech: string;
  currency: string;
  currencyDesc: string;
  appearance: string;
  appearanceDesc: string;
  light: string;
  dark: string;
  navigation: string;
  navigationDesc: string;
  alwaysVisible: string;
  reorder: string;
  tasks: string;
  tasksDesc: string;
  tasksAll: string;
  cv: string;
  cvDesc: string;
  cvCzech: string;
  cvEnglish: string;
  cvPlaceholder: string;
  resetNavigation: string;
  ai: string;
  aiDesc: string;
  aiEnabled: string;
  aiSensitive: string;
  aiSensitiveDesc: string;
  aiModels: string;
  aiDataCategories: string;
  aiWrites: string;
  notifications: string;
  notificationsDesc: string;
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
  projectWithoutRepository: string;
  projectUpdateFailed: string;
  preferenceSaveFailed: string;
  preferenceSyncUnavailable: string;
  projectSections: string;
  projectSectionsDesc: string;
};

export const settings: { en: SettingsStrings; cs: SettingsStrings } = {
  en: {
    title: "Settings",
    description: "Personalize your dashboard.",
    language: "Language",
    languageDesc: "Choose the language for the whole app.",
    english: "English",
    czech: "Čeština",
    currency: "Display currency",
    currencyDesc: "All totals and charts are converted into this currency.",
    appearance: "Appearance",
    appearanceDesc: "Switch between light and dark mode.",
    light: "Light",
    dark: "Dark",
    navigation: "Navigation sections",
    navigationDesc:
      "Toggle which sections appear in navigation and drag to reorder within each group. Home and Inbox stay pinned.",
    alwaysVisible: "Always visible",
    reorder: "Drag to reorder",
    tasks: "Tasks",
    tasksDesc:
      "How many tasks each category shows before “show all”.",
    tasksAll: "All",
    cv: "CV links",
    cvDesc:
      "Google Docs links to your CVs — shown as buttons on the Career page. Paste the share URL; editing the doc keeps the same link.",
    cvCzech: "🇨🇿 Czech CV",
    cvEnglish: "🇬🇧 English CV",
    cvPlaceholder: "https://docs.google.com/document/d/…",
    resetNavigation: "Reset navigation",
    ai: "AI & privacy",
    aiDesc: "AI is contextual and opt-in. Model output is previewed before any write.",
    aiEnabled: "Enable contextual AI",
    aiSensitive: "Allow sensitive context",
    aiSensitiveDesc: "Off by default. Only enable when you intentionally want financial or private text included.",
    aiModels: "Fast models classify short captures; synthesis models create bounded, source-backed briefs and proposals. Model identifiers are configured on the server.",
    aiDataCategories: "Sensitive workflows may send selected project, task, cost, invoice metadata, career, note, repository-document, client, subscription, and date records after confirmation.",
    aiWrites: "AI output is a preview. Database writes always require a separate confirmation; destructive and external actions are unsupported.",
    notifications: "Notifications",
    notificationsDesc: "Choose only the notification types currently supported by the app.",
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
    projectWithoutRepository: "No GitHub repository linked",
    projectUpdateFailed: "Could not update the active project.",
    preferenceSaveFailed: "Could not synchronize this setting.",
    preferenceSyncUnavailable:
      "Database preference sync is unavailable. Local choices are preserved on this device; apply the latest Supabase migrations to restore cross-device sync.",
    projectSections: "Project workspace sections",
    projectSectionsDesc:
      "Choose which tabs appear inside every project workspace. Overview always stays visible.",
  },
  cs: {
    title: "Nastavení",
    description: "Přizpůsobte si svůj přehled.",
    language: "Jazyk",
    languageDesc: "Vyberte jazyk pro celou aplikaci.",
    english: "English",
    czech: "Čeština",
    currency: "Zobrazená měna",
    currencyDesc: "Všechny součty a grafy se převádějí do této měny.",
    appearance: "Vzhled",
    appearanceDesc: "Přepínejte mezi světlým a tmavým režimem.",
    light: "Světlý",
    dark: "Tmavý",
    navigation: "Sekce navigace",
    navigationDesc:
      "Zapněte sekce navigace a přetažením změňte jejich pořadí ve skupině. Domů a Inbox zůstávají připnuté.",
    alwaysVisible: "Vždy viditelné",
    reorder: "Přetáhni pro změnu pořadí",
    tasks: "Úkoly",
    tasksDesc: "Kolik úkolů každá kategorie zobrazí před „zobrazit vše“.",
    tasksAll: "Vše",
    cv: "Odkazy na CV",
    cvDesc:
      "Odkazy na tvoje životopisy v Google Docs — zobrazí se jako tlačítka na stránce Práce. Vlož sdílecí URL; úpravy dokumentu odkaz nemění.",
    cvCzech: "🇨🇿 České CV",
    cvEnglish: "🇬🇧 Anglické CV",
    cvPlaceholder: "https://docs.google.com/document/d/…",
    resetNavigation: "Obnovit navigaci",
    ai: "AI a soukromí",
    aiDesc: "AI je kontextová a volitelná. Před každým zápisem se zobrazí náhled.",
    aiEnabled: "Povolit kontextovou AI",
    aiSensitive: "Povolit citlivý kontext",
    aiSensitiveDesc: "Ve výchozím stavu vypnuto. Zapněte jen tehdy, když chcete vědomě zahrnout finanční nebo soukromý text.",
    aiModels: "Rychlé modely třídí krátké záznamy; syntetizační modely vytvářejí omezené, zdroji podložené přehledy a návrhy. Identifikátory modelů se nastavují na serveru.",
    aiDataCategories: "Citlivé postupy mohou po potvrzení odeslat vybrané záznamy projektů, úkolů, nákladů, metadat faktur, kariéry, poznámek, dokumentů repozitáře, klientů, předplatných a termínů.",
    aiWrites: "Výstup AI je náhled. Zápis do databáze vždy vyžaduje samostatné potvrzení; destruktivní a externí akce nejsou podporovány.",
    notifications: "Oznámení",
    notificationsDesc: "Vyberte pouze typy oznámení, které aplikace aktuálně podporuje.",
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
    projectWithoutRepository: "Bez napojeného GitHub repozitáře",
    projectUpdateFailed: "Aktivní projekt se nepodařilo změnit.",
    preferenceSaveFailed: "Toto nastavení se nepodařilo synchronizovat.",
    preferenceSyncUnavailable:
      "Databázová synchronizace nastavení není dostupná. Lokální volby na tomto zařízení zůstanou zachované; pro synchronizaci mezi zařízeními aplikuj nejnovější Supabase migrace.",
    projectSections: "Sekce projektového workspace",
    projectSectionsDesc:
      "Vyber, které záložky se zobrazí uvnitř každého projektu. Přehled zůstává vždy viditelný.",
  },
};
