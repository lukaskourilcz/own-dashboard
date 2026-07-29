type JobsStrings = {
  title: string;
  description: string;
  // Sub-tabs
  openTab: string;
  appliedTab: string;
  // CV quick-links
  cvCzech: string;
  cvEnglish: string;
  // Header / refresh
  lastChecked: string;
  never: string;
  checkNow: string;
  checking: string;
  refreshOk: string;
  refreshErr: string;
  refreshRateLimited: string;
  sourceErrors: string;
  // Data sources
  sourcesTitle: string;
  sourcesDescription: string;
  sourcesShow: string;
  sourcesHide: string;
  sourceKindJson: string;
  sourceKindHtml: string;
  sourceKindRss: string;
  sourceFound: (n: number) => string;
  sourceRemoved: (n: number) => string;
  sourceComplete: string;
  sourceCompleteHint: string;
  sourcePartial: string;
  sourcePartialHint: string;
  sourceNoRun: string;
  sourceOpen: string;
  // Filters
  searchPlaceholder: string;
  roleAll: string;
  roleFrontend: string;
  roleFullstack: string;
  roleSoftware: string;
  sourceAll: string;
  shortlistedOnly: string;
  // Sort + fit filters
  sortLabel: string;
  sortBestFit: string;
  sortLowestFit: string;
  sortNewest: string;
  sortRemote: string;
  sortLocation: string;
  priorityOnly: string;
  strongFitOnly: string;
  // Fit score + skills
  fitSuffix: string;
  fitUnknown: string;
  fitUnknownHint: string;
  fitHint: (matched: number, missing: number) => string;
  fitYouHave: string;
  fitGaps: string;
  // Listing cards
  remoteBadge: string;
  appliedBadge: string;
  applyAction: string;
  openOriginal: string;
  shortlist: string;
  unshortlist: string;
  deleteListing: string;
  deleteSelected: (count: number) => string;
  deleteListingsTitle: string;
  deleteListingsDescription: (count: number) => string;
  selectedListings: (count: number) => string;
  selectAllListings: string;
  listingDeleted: string;
  firstSeen: string;
  posted: string;
  noListingsYet: string;
  noListingsDescription: string;
  noMatches: string;
  noMatchesDescription: string;
  listingsShown: string;
  tablePosition: string;
  tableCompany: string;
  tableMatch: string;
  tableRemote: string;
  tableLocation: string;
  tableSource: string;
  tableActions: string;
  remoteYes: string;
  remoteNo: string;
  // Apply dialog / application form
  applyTitle: string;
  logManualTitle: string;
  logManual: string;
  position: string;
  positionPlaceholder: string;
  company: string;
  companyPlaceholder: string;
  link: string;
  appliedOn: string;
  coverLetter: string;
  coverLetterPlaceholder: string;
  loadTemplate: string;
  builtinTemplatesGroup: string;
  savedTemplatesGroup: string;
  overwriteLetterConfirm: string;
  saveAsTemplate: string;
  saveAsTemplateName: string;
  notes: string;
  notesPlaceholder: string;
  saveApplication: string;
  saving: string;
  applicationSaved: string;
  positionRequired: string;
  signInFirst: string;
  couldNotSave: string;
  couldNotDelete: string;
  cancel: string;
  save: string;
  // Applied view
  statsTotal: string;
  statsLast7: string;
  statsLast30: string;
  statsActive: string;
  statusLabel: string;
  statusApplied: string;
  statusInterviewing: string;
  statusOffer: string;
  statusRejected: string;
  statusWithdrawn: string;
  appliedOnLabel: string;
  history: string;
  coverLetterAction: string;
  letterSaved: string;
  statusUpdated: string;
  deleteApplication: string;
  deleteApplicationConfirm: string;
  applicationDeleted: string;
  noApplicationsYet: string;
  noApplicationsDescription: string;
  eventApplied: string;
  eventStatus: string;
  eventNote: string;
  // Templates manager
  manageTemplates: string;
  templatesTitle: string;
  templatesDescription: string;
  newTemplate: string;
  editTemplate: string;
  templateName: string;
  templateNamePlaceholder: string;
  templateBody: string;
  templateBodyPlaceholder: string;
  placeholdersHint: string;
  templateSaved: string;
  templateDeleted: string;
  deleteTemplate: string;
  deleteTemplateConfirm: string;
  noTemplatesYet: string;
  nameRequired: string;
  bodyRequired: string;
};

export const jobs: { en: JobsStrings; cs: JobsStrings } = {
  en: {
    title: "Career",
    description:
      "Remote-friendly European openings for frontend, fullstack and software engineers — checked daily at 10:00.",
    openTab: "Open positions",
    appliedTab: "Applied",
    cvCzech: "Open Czech CV",
    cvEnglish: "Open English CV",
    lastChecked: "Last checked",
    never: "never",
    checkNow: "Check now",
    checking: "Checking…",
    refreshOk: "Job boards checked.",
    refreshErr: "Could not check the job boards. Please try again.",
    refreshRateLimited: "Too many refreshes — try again in a few minutes.",
    sourceErrors: "Some boards failed on the last check",
    sourcesTitle: "Where these offers come from",
    sourcesDescription:
      "Eight job boards are queried on every check. An offer disappears from this list as soon as the board that supplied it stops carrying it.",
    sourcesShow: "Show sources",
    sourcesHide: "Hide sources",
    sourceKindJson: "JSON API",
    sourceKindHtml: "HTML",
    sourceKindRss: "RSS",
    sourceFound: (n: number) => `${n} found`,
    sourceRemoved: (n: number) => `${n} removed`,
    sourceComplete: "Full board",
    sourceCompleteHint:
      "One request returns the whole board, so an offer missing from the response is removed straight away.",
    sourcePartial: "Partial",
    sourcePartialHint:
      "This board is read page by page, so a missing offer is checked over HTTP first and removed only once its page is gone.",
    sourceNoRun: "Not checked yet",
    sourceOpen: "Open board",
    searchPlaceholder: "Search title, company, location…",
    roleAll: "All roles",
    roleFrontend: "Frontend",
    roleFullstack: "Fullstack",
    roleSoftware: "Software",
    sourceAll: "All sources",
    shortlistedOnly: "Shortlisted",
    sortLabel: "Sort",
    sortBestFit: "Best fit",
    sortLowestFit: "Lowest fit",
    sortNewest: "Newest",
    sortRemote: "Remote first",
    sortLocation: "Location A–Z",
    priorityOnly: "FE + FS",
    strongFitOnly: "Strong fit",
    fitSuffix: "fit",
    fitUnknown: "No tech listed",
    fitUnknownHint:
      "This posting names no recognizable technology, so it can't be scored.",
    fitHint: (matched, missing) =>
      `You match ${matched} skill${matched === 1 ? "" : "s"}${
        missing > 0 ? `, ${missing} gap${missing === 1 ? "" : "s"}` : ""
      } for this role.`,
    fitYouHave: "You have",
    fitGaps: "Gaps",
    remoteBadge: "Remote",
    appliedBadge: "Applied",
    applyAction: "Apply",
    openOriginal: "Open the original posting",
    shortlist: "Shortlist",
    unshortlist: "Remove from shortlist",
    deleteListing: "Delete permanently",
    deleteSelected: (count) => `Delete ${count}`,
    deleteListingsTitle: "Delete selected positions?",
    deleteListingsDescription: (count) =>
      `${count} selected position${count === 1 ? "" : "s"} will be permanently removed from your feed and will not return after another check.`,
    selectedListings: (count) => `${count} selected`,
    selectAllListings: "Select all visible rows",
    listingDeleted: "Selected positions were deleted.",
    firstSeen: "Found",
    posted: "Posted",
    noListingsYet: "No open positions yet",
    noListingsDescription:
      "The daily check runs at 10:00 (Prague time). Use “Check now” to fetch the boards immediately.",
    noMatches: "Nothing matches",
    noMatchesDescription: "Try different filters or clear the search.",
    listingsShown: "positions",
    tablePosition: "Position",
    tableCompany: "Company",
    tableMatch: "Match",
    tableRemote: "Remote",
    tableLocation: "Location",
    tableSource: "Source / found",
    tableActions: "Actions",
    remoteYes: "Yes",
    remoteNo: "No",
    applyTitle: "Apply for this position",
    logManualTitle: "Log an application",
    logManual: "Log application",
    position: "Position",
    positionPlaceholder: "e.g. Senior Frontend Engineer",
    company: "Company",
    companyPlaceholder: "e.g. Acme s.r.o.",
    link: "Link",
    appliedOn: "Applied on",
    coverLetter: "Cover letter",
    coverLetterPlaceholder:
      "Write your cover letter here, or load one of your templates…",
    loadTemplate: "Load template",
    builtinTemplatesGroup: "Starter templates",
    savedTemplatesGroup: "Your templates",
    overwriteLetterConfirm:
      "Replace the current cover letter with the template?",
    saveAsTemplate: "Save as template",
    saveAsTemplateName: "Template name:",
    notes: "Notes",
    notesPlaceholder: "Contact person, salary discussed, next steps…",
    saveApplication: "Save application",
    saving: "Saving…",
    applicationSaved: "Application saved — good luck!",
    positionRequired: "Position title is required.",
    signInFirst: "Sign in first.",
    couldNotSave: "Could not save. Please try again.",
    couldNotDelete: "Could not delete. Please try again.",
    cancel: "Cancel",
    save: "Save",
    statsTotal: "Total",
    statsLast7: "Last 7 days",
    statsLast30: "Last 30 days",
    statsActive: "Active",
    statusLabel: "Status",
    statusApplied: "Applied",
    statusInterviewing: "Interviewing",
    statusOffer: "Offer",
    statusRejected: "Rejected",
    statusWithdrawn: "Withdrawn",
    appliedOnLabel: "Applied",
    history: "History",
    coverLetterAction: "Cover letter",
    letterSaved: "Cover letter saved.",
    statusUpdated: "Status updated.",
    deleteApplication: "Delete application",
    deleteApplicationConfirm:
      "Delete this application and its history? This cannot be undone.",
    applicationDeleted: "Application deleted.",
    noApplicationsYet: "No applications yet",
    noApplicationsDescription:
      "Apply to a position from the Open positions tab — the cover letter and the date are tracked here.",
    eventApplied: "Applied",
    eventStatus: "Status →",
    eventNote: "Note",
    manageTemplates: "Templates",
    templatesTitle: "Cover letter templates",
    templatesDescription:
      "Reusable letters you can load into any application.",
    newTemplate: "New template",
    editTemplate: "Edit template",
    templateName: "Name",
    templateNamePlaceholder: "e.g. Frontend — English",
    templateBody: "Template text",
    templateBodyPlaceholder: "Dear Hiring Manager…",
    placeholdersHint:
      "Placeholders {{position}}, {{company}}, {{source}} and {{date}} are filled in when the template is loaded.",
    templateSaved: "Template saved.",
    templateDeleted: "Template deleted.",
    deleteTemplate: "Delete template",
    deleteTemplateConfirm: "Delete this template?",
    noTemplatesYet: "No saved templates yet — the starter templates below are always available.",
    nameRequired: "Name is required.",
    bodyRequired: "Template text is required.",
  },
  cs: {
    title: "Kariéra",
    description:
      "Remote pozice v Evropě pro frontend, fullstack a software inženýry — kontrolováno denně v 10:00.",
    openTab: "Otevřené pozice",
    appliedTab: "Odeslané přihlášky",
    cvCzech: "Otevřít české CV",
    cvEnglish: "Otevřít anglické CV",
    lastChecked: "Naposledy zkontrolováno",
    never: "nikdy",
    checkNow: "Zkontrolovat teď",
    checking: "Kontroluji…",
    refreshOk: "Pracovní portály zkontrolovány.",
    refreshErr: "Portály se nepodařilo zkontrolovat. Zkuste to znovu.",
    refreshRateLimited: "Příliš mnoho kontrol — zkuste to za pár minut.",
    sourceErrors: "Některé portály při poslední kontrole selhaly",
    sourcesTitle: "Odkud nabídky pocházejí",
    sourcesDescription:
      "Při každé kontrole se dotazuje osm pracovních portálů. Nabídka ze seznamu zmizí, jakmile ji portál, který ji dodal, přestane nabízet.",
    sourcesShow: "Zobrazit zdroje",
    sourcesHide: "Skrýt zdroje",
    sourceKindJson: "JSON API",
    sourceKindHtml: "HTML",
    sourceKindRss: "RSS",
    sourceFound: (n: number) => `nalezeno ${n}`,
    sourceRemoved: (n: number) => `odebráno ${n}`,
    sourceComplete: "Celý portál",
    sourceCompleteHint:
      "Jeden dotaz vrátí celý portál, takže nabídka chybějící v odpovědi se odebere okamžitě.",
    sourcePartial: "Částečný",
    sourcePartialHint:
      "Tento portál se čte po stránkách, takže se chybějící nabídka nejdřív ověří přes HTTP a odebere se až ve chvíli, kdy její stránka zmizí.",
    sourceNoRun: "Zatím nezkontrolováno",
    sourceOpen: "Otevřít portál",
    searchPlaceholder: "Hledat pozici, firmu, lokalitu…",
    roleAll: "Všechny role",
    roleFrontend: "Frontend",
    roleFullstack: "Fullstack",
    roleSoftware: "Software",
    sourceAll: "Všechny zdroje",
    shortlistedOnly: "Oblíbené",
    sortLabel: "Řadit",
    sortBestFit: "Nejlepší shoda",
    sortLowestFit: "Nejnižší shoda",
    sortNewest: "Nejnovější",
    sortRemote: "Nejdříve remote",
    sortLocation: "Lokalita A–Z",
    priorityOnly: "FE + FS",
    strongFitOnly: "Silná shoda",
    fitSuffix: "shoda",
    fitUnknown: "Bez technologií",
    fitUnknownHint:
      "Inzerát neuvádí žádnou rozpoznatelnou technologii, nelze ho ohodnotit.",
    fitHint: (matched, missing) =>
      `Shoda: ${matched} ${csSkills(matched)}${
        missing > 0 ? `, ${missing} ${csGaps(missing)}` : ""
      }.`,
    fitYouHave: "Umíš",
    fitGaps: "Chybí",
    remoteBadge: "Remote",
    appliedBadge: "Přihlášeno",
    applyAction: "Přihlásit se",
    openOriginal: "Otevřít původní inzerát",
    shortlist: "Přidat do oblíbených",
    unshortlist: "Odebrat z oblíbených",
    deleteListing: "Nenávratně smazat",
    deleteSelected: (count) => `Smazat (${count})`,
    deleteListingsTitle: "Smazat vybrané pozice?",
    deleteListingsDescription: (count) =>
      `${count} vybraných pozic bude trvale odebráno z tvého přehledu a nevrátí se ani po další kontrole.`,
    selectedListings: (count) => `Vybráno: ${count}`,
    selectAllListings: "Vybrat všechny viditelné řádky",
    listingDeleted: "Vybrané pozice byly smazány.",
    firstSeen: "Nalezeno",
    posted: "Zveřejněno",
    noListingsYet: "Zatím žádné otevřené pozice",
    noListingsDescription:
      "Denní kontrola běží v 10:00. Tlačítkem „Zkontrolovat teď“ načtete portály okamžitě.",
    noMatches: "Nic neodpovídá",
    noMatchesDescription: "Zkuste jiné filtry nebo smažte hledání.",
    listingsShown: "pozic",
    tablePosition: "Pozice",
    tableCompany: "Firma",
    tableMatch: "Shoda",
    tableRemote: "Remote",
    tableLocation: "Lokalita",
    tableSource: "Zdroj / nalezeno",
    tableActions: "Akce",
    remoteYes: "Ano",
    remoteNo: "Ne",
    applyTitle: "Přihlásit se na pozici",
    logManualTitle: "Zaznamenat přihlášku",
    logManual: "Zaznamenat přihlášku",
    position: "Pozice",
    positionPlaceholder: "např. Senior Frontend Engineer",
    company: "Firma",
    companyPlaceholder: "např. Acme s.r.o.",
    link: "Odkaz",
    appliedOn: "Datum přihlášení",
    coverLetter: "Motivační dopis",
    coverLetterPlaceholder:
      "Napište motivační dopis, nebo načtěte některou ze šablon…",
    loadTemplate: "Načíst šablonu",
    builtinTemplatesGroup: "Výchozí šablony",
    savedTemplatesGroup: "Vaše šablony",
    overwriteLetterConfirm: "Nahradit aktuální motivační dopis šablonou?",
    saveAsTemplate: "Uložit jako šablonu",
    saveAsTemplateName: "Název šablony:",
    notes: "Poznámky",
    notesPlaceholder: "Kontaktní osoba, mzda, další kroky…",
    saveApplication: "Uložit přihlášku",
    saving: "Ukládání…",
    applicationSaved: "Přihláška uložena — hodně štěstí!",
    positionRequired: "Název pozice je povinný.",
    signInFirst: "Nejprve se přihlaste.",
    couldNotSave: "Nepodařilo se uložit. Zkuste to znovu.",
    couldNotDelete: "Nepodařilo se smazat. Zkuste to znovu.",
    cancel: "Zrušit",
    save: "Uložit",
    statsTotal: "Celkem",
    statsLast7: "Posledních 7 dní",
    statsLast30: "Posledních 30 dní",
    statsActive: "Aktivní",
    statusLabel: "Stav",
    statusApplied: "Přihlášeno",
    statusInterviewing: "Pohovor",
    statusOffer: "Nabídka",
    statusRejected: "Zamítnuto",
    statusWithdrawn: "Staženo",
    appliedOnLabel: "Přihlášeno",
    history: "Historie",
    coverLetterAction: "Motivační dopis",
    letterSaved: "Motivační dopis uložen.",
    statusUpdated: "Stav aktualizován.",
    deleteApplication: "Smazat přihlášku",
    deleteApplicationConfirm:
      "Smazat tuto přihlášku včetně historie? Akci nelze vrátit zpět.",
    applicationDeleted: "Přihláška smazána.",
    noApplicationsYet: "Zatím žádné přihlášky",
    noApplicationsDescription:
      "Přihlaste se na pozici v záložce Otevřené pozice — motivační dopis i datum se uloží sem.",
    eventApplied: "Přihlášeno",
    eventStatus: "Stav →",
    eventNote: "Poznámka",
    manageTemplates: "Šablony",
    templatesTitle: "Šablony motivačních dopisů",
    templatesDescription:
      "Opakovaně použitelné dopisy, které načtete do kterékoli přihlášky.",
    newTemplate: "Nová šablona",
    editTemplate: "Upravit šablonu",
    templateName: "Název",
    templateNamePlaceholder: "např. Frontend — anglicky",
    templateBody: "Text šablony",
    templateBodyPlaceholder: "Dobrý den…",
    placeholdersHint:
      "Zástupné symboly {{position}}, {{company}}, {{source}} a {{date}} se doplní při načtení šablony.",
    templateSaved: "Šablona uložena.",
    templateDeleted: "Šablona smazána.",
    deleteTemplate: "Smazat šablonu",
    deleteTemplateConfirm: "Smazat tuto šablonu?",
    noTemplatesYet:
      "Zatím žádné uložené šablony — výchozí šablony níže jsou k dispozici vždy.",
    nameRequired: "Název je povinný.",
    bodyRequired: "Text šablony je povinný.",
  },
};

// Czech plural for "dovednost" (skill): 1 → singular, 2–4 → few, 0/5+ → many.
function csSkills(n: number): string {
  if (n === 1) return "dovednost";
  if (n >= 2 && n <= 4) return "dovednosti";
  return "dovedností";
}

// Czech plural for "mezera" (gap): 1 → singular, 2–4 → few, 0/5+ → many.
function csGaps(n: number): string {
  if (n === 1) return "mezera";
  if (n >= 2 && n <= 4) return "mezery";
  return "mezer";
}
