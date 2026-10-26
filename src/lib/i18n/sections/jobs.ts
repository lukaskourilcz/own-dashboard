type JobsStrings = {
  title: string;
  description: string;
  // Sub-tabs
  openTab: string;
  savedTab: string;
  appliedTab: string;
  // CV quick-links
  cvCzech: string;
  cvEnglish: string;
  // Header / refresh
  lastChecked: string;
  never: string;
  checking: string;
  refreshOk: string;
  refreshErr: string;
  refreshLoadErr: string;
  refreshReload: string;
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
  appliedBadge: string;
  savedBadge: string;
  savePosition: string;
  positionSaved: string;
  saveUnconfirmed: string;
  saveListingChanged: string;
  triageUnconfirmed: string;
  triageChanged: string;
  triageLimit: string;
  triageReloadFailed: string;
  triageReload: string;
  clearSelection: string;
  saveByUrl: string;
  saveByUrlDescription: string;
  importFromUrl: string;
  importing: string;
  urlImportFailed: string;
  noSavedPositions: string;
  noSavedPositionsDescription: string;
  prepareApplication: string;
  saveDraft: string;
  draftSaved: string;
  openOriginal: string;
  shortlist: string;
  unshortlist: string;
  deleteListing: string;
  deleteSelected: (count: number) => string;
  deleteListingsTitle: string;
  deleteListingsDescription: (count: number) => string;
  selectedListings: (count: number) => string;
  listingDeleted: string;
  noListingsYet: string;
  noListingsDescription: string;
  noMatches: string;
  noMatchesDescription: string;
  listingsShown: string;
  listingPages: string;
  savedPages: string;
  applicationPages: string;
  previousPage: string;
  nextPage: string;
  pageRange: (from: number, to: number, total: number) => string;
  tableActions: string;
  // Apply dialog / application form
  applyTitle: string;
  logManualTitle: string;
  position: string;
  positionPlaceholder: string;
  company: string;
  companyPlaceholder: string;
  link: string;
  appliedOn: string;
  coverLetter: string;
  letterGuidance: string;
  coverLetterPlaceholder: string;
  loadTemplate: string;
  builtinTemplatesGroup: string;
  savedTemplatesGroup: string;
  overwriteLetterConfirm: string;
  saveAsTemplate: string;
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
  // Stage board
  layoutLabel: string;
  listView: string;
  boardView: string;
  boardRegion: string;
  boardPages: (column: string) => string;
  boardHint: string;
  boardColumnClosed: string;
  boardColumnEmpty: string;
  boardMoveCard: (title: string) => string;
  boardSavedNotDraggable: string;
  followUpDue: string;
  followUpOn: string;
  contactLabel: string;
  contactName: string;
  contactEmail: string;
  // Templates manager
  manageTemplates: string;
  templatesTitle: string;
  templatesDescription: string;
  newTemplate: string;
  editTemplate: string;
  templateName: string;
  templateSearch: string;
  untitledTemplate: string;
  emptyTemplate: string;
  noMatchingTemplates: string;
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
  checkOffers: string;
  gateTitle: string;
  gateDescription: string;
};

export const jobs: { en: JobsStrings; cs: JobsStrings } = {
  en: {
    title: "Career",
    description:
      "Frontend, fullstack and AI integration roles in Oslo. Prepare and track each application.",
    openTab: "Open positions",
    savedTab: "Saved",
    appliedTab: "Applied",
    cvCzech: "Open Czech CV",
    cvEnglish: "Open English CV",
    lastChecked: "Last checked",
    never: "never",
    checking: "Checking…",
    refreshOk: "Job boards checked.",
    refreshErr: "Could not confirm the job-board check. Please try again.",
    refreshLoadErr: "Job boards were checked, but Career could not reload.",
    refreshReload: "Reload saved Career",
    refreshRateLimited: "Too many refreshes — try again in a few minutes.",
    sourceErrors: "Some boards failed on the last check",
    sourcesTitle: "Where these offers come from",
    sourcesDescription:
      "Job boards and direct employer feeds. Availability is checked each time you check for new offers; uncertain results stay hidden.",
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
    fitSuffix: "stack overlap",
    fitUnknown: "No tech listed",
    fitUnknownHint:
      "This posting names no recognizable technology, so it can't be scored.",
    fitHint: (matched, missing) =>
      `You match ${matched} skill${matched === 1 ? "" : "s"}${
        missing > 0 ? `, ${missing} gap${missing === 1 ? "" : "s"}` : ""
      } for this role.`,
    fitYouHave: "You have",
    fitGaps: "Gaps",
    appliedBadge: "Applied",
    savedBadge: "Saved",
    savePosition: "Save position",
    positionSaved: "Position saved.",
    saveUnconfirmed: "Saving this position was not confirmed.",
    saveListingChanged: "This offer changed. Check for new offers before saving it.",
    triageUnconfirmed: "The change was not confirmed.",
    triageChanged: "These offers changed. Reload current offers and select them again.",
    triageLimit: "Select at most 1,000 offers per change.",
    triageReloadFailed: "Could not reload current offers.",
    triageReload: "Reload offers",
    clearSelection: "Clear selection",
    saveByUrl: "Save a position from a link",
    saveByUrlDescription: "Paste a job URL, then choose Fill from URL or enter the details manually.",
    importFromUrl: "Fill from URL",
    importing: "Reading page…",
    urlImportFailed: "The page could not be read. Enter the position details manually.",
    noSavedPositions: "No saved positions",
    noSavedPositionsDescription: "Save a position from Open positions or paste its URL above.",
    prepareApplication: "Prepare application",
    saveDraft: "Save draft",
    draftSaved: "Application draft saved.",
    openOriginal: "Open the original posting",
    shortlist: "Shortlist",
    unshortlist: "Remove from shortlist",
    deleteListing: "Delete permanently",
    deleteSelected: (count) => `Delete ${count}`,
    deleteListingsTitle: "Delete selected positions?",
    deleteListingsDescription: (count) =>
      `${count} selected position${count === 1 ? "" : "s"} will be permanently removed from your feed and will not return after another check.`,
    selectedListings: (count) => `${count} selected`,
    listingDeleted: "Selected positions were deleted.",
    noListingsYet: "No open positions yet",
    noListingsDescription:
      "Use “Check now” to refresh selected boards. Career does not run background checks.",
    noMatches: "Nothing matches",
    noMatchesDescription: "Try different filters or clear the search.",
    listingsShown: "positions",
    listingPages: "Listing pages",
    savedPages: "Saved position pages",
    applicationPages: "Application pages",
    previousPage: "Previous",
    nextPage: "Next",
    pageRange: (from, to, total) => `${from}–${to} of ${total}`,
    tableActions: "Actions",
    applyTitle: "Prepare this application",
    logManualTitle: "Log an application",
    position: "Position",
    positionPlaceholder: "e.g. Senior Frontend Engineer",
    company: "Company",
    companyPlaceholder: "e.g. Acme s.r.o.",
    link: "Link",
    appliedOn: "Applied on",
    coverLetter: "Cover letter",
    letterGuidance: "Draft assistance",
    coverLetterPlaceholder:
      "Write your cover letter here, or load one of your templates…",
    loadTemplate: "Load template",
    builtinTemplatesGroup: "Starter templates",
    savedTemplatesGroup: "Your templates",
    overwriteLetterConfirm:
      "Replace the current cover letter with the template?",
    saveAsTemplate: "Save letter / template",
    notes: "Notes",
    notesPlaceholder: "Contact person, salary discussed, next steps…",
    saveApplication: "Record sent application",
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
    layoutLabel: "Layout",
    listView: "List",
    boardView: "Board",
    boardRegion: "Application stages",
    boardPages: column => `${column} pages`,
    boardHint:
      "Drag a card to another stage, or use the stage menu on the card. A saved position becomes an application through Review / mark as sent, which records the real date you applied.",
    boardColumnClosed: "Closed",
    boardColumnEmpty: "Nothing at this stage.",
    boardMoveCard: (title: string) => `Move ${title} to another stage`,
    boardSavedNotDraggable: "Not sent yet",
    followUpDue: "Follow-up due",
    followUpOn: "Follow up",
    contactLabel: "Contact at the company",
    contactName: "Contact name",
    contactEmail: "Contact email",
    manageTemplates: "Templates",
    templatesTitle: "Cover letter templates",
    templatesDescription:
      "Reusable letters you can load into any application.",
    newTemplate: "New template",
    editTemplate: "Edit template",
    templateName: "Name",
    templateSearch: "Search template names",
    untitledTemplate: "Untitled template",
    emptyTemplate: "Empty template",
    noMatchingTemplates: "No templates match this search.",
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
    checkOffers: "Check for new offers",
    gateTitle: "Career loads when you ask",
    gateDescription: "Nothing is fetched until you check. Checking refreshes the job boards, verifies which listings are still open and loads your saved positions, applications and letters.",
  },
  cs: {
    title: "Kariéra",
    description:
      "Frontend, fullstack a AI integrace v Oslu. Připravte a sledujte každou přihlášku.",
    openTab: "Otevřené pozice",
    savedTab: "Uložené",
    appliedTab: "Odeslané přihlášky",
    cvCzech: "Otevřít české CV",
    cvEnglish: "Otevřít anglické CV",
    lastChecked: "Naposledy zkontrolováno",
    never: "nikdy",
    checking: "Kontroluji…",
    refreshOk: "Pracovní portály zkontrolovány.",
    refreshErr: "Kontrolu portálů se nepodařilo potvrdit. Zkuste to znovu.",
    refreshLoadErr: "Portály byly zkontrolovány, ale Kariéra se nenačetla.",
    refreshReload: "Načíst uloženou Kariéru",
    refreshRateLimited: "Příliš mnoho kontrol — zkuste to za pár minut.",
    sourceErrors: "Některé portály při poslední kontrole selhaly",
    sourcesTitle: "Odkud nabídky pocházejí",
    sourcesDescription:
      "Pracovní portály a přímé zdroje zaměstnavatelů. Dostupnost se ověřuje při každé kontrole nových nabídek; nejisté výsledky zůstávají skryté.",
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
    appliedBadge: "Přihlášeno",
    savedBadge: "Uloženo",
    savePosition: "Uložit pozici",
    positionSaved: "Pozice byla uložena.",
    saveUnconfirmed: "Uložení pozice není potvrzené.",
    saveListingChanged: "Tato nabídka se změnila. Před uložením znovu ověřte aktuální nabídky.",
    triageUnconfirmed: "Změnu se nepodařilo potvrdit.",
    triageChanged: "Nabídky se změnily. Načtěte aktuální nabídky a vyberte je znovu.",
    triageLimit: "Pro jednu změnu vyberte nejvýše 1 000 nabídek.",
    triageReloadFailed: "Aktuální nabídky se nepodařilo načíst.",
    triageReload: "Načíst nabídky",
    clearSelection: "Zrušit výběr",
    saveByUrl: "Uložit pozici z odkazu",
    saveByUrlDescription: "Vložte URL inzerátu. Pak zvolte Doplnit z URL, nebo údaje vyplňte ručně.",
    importFromUrl: "Doplnit z URL",
    importing: "Načítám stránku…",
    urlImportFailed: "Stránku se nepodařilo načíst. Vyplňte údaje o pozici ručně.",
    noSavedPositions: "Žádné uložené pozice",
    noSavedPositionsDescription: "Uložte pozici z otevřených nabídek nebo vložte její URL výše.",
    prepareApplication: "Připravit přihlášku",
    saveDraft: "Uložit koncept",
    draftSaved: "Koncept přihlášky byl uložen.",
    openOriginal: "Otevřít původní inzerát",
    shortlist: "Přidat do oblíbených",
    unshortlist: "Odebrat z oblíbených",
    deleteListing: "Nenávratně smazat",
    deleteSelected: (count) => `Smazat (${count})`,
    deleteListingsTitle: "Smazat vybrané pozice?",
    deleteListingsDescription: (count) =>
      `${count} vybraných pozic bude trvale odebráno z tvého přehledu a nevrátí se ani po další kontrole.`,
    selectedListings: (count) => `Vybráno: ${count}`,
    listingDeleted: "Vybrané pozice byly smazány.",
    noListingsYet: "Zatím žádné otevřené pozice",
    noListingsDescription:
      "Vybrané portály načtete tlačítkem „Zkontrolovat teď“. Kariéra nespouští kontroly na pozadí.",
    noMatches: "Nic neodpovídá",
    noMatchesDescription: "Zkuste jiné filtry nebo smažte hledání.",
    listingsShown: "pozic",
    listingPages: "Stránky nabídek",
    savedPages: "Stránky uložených pozic",
    applicationPages: "Stránky přihlášek",
    previousPage: "Předchozí",
    nextPage: "Další",
    pageRange: (from, to, total) => `${from}–${to} z ${total}`,
    tableActions: "Akce",
    applyTitle: "Připravit žádost",
    logManualTitle: "Zaznamenat přihlášku",
    position: "Pozice",
    positionPlaceholder: "např. Senior Frontend Engineer",
    company: "Firma",
    companyPlaceholder: "např. Acme s.r.o.",
    link: "Odkaz",
    appliedOn: "Datum přihlášení",
    coverLetter: "Motivační dopis",
    letterGuidance: "Pomoc s návrhem dopisu",
    coverLetterPlaceholder:
      "Napište motivační dopis, nebo načtěte některou ze šablon…",
    loadTemplate: "Načíst šablonu",
    builtinTemplatesGroup: "Výchozí šablony",
    savedTemplatesGroup: "Vaše šablony",
    overwriteLetterConfirm: "Nahradit aktuální motivační dopis šablonou?",
    saveAsTemplate: "Uložit dopis / šablonu",
    notes: "Poznámky",
    notesPlaceholder: "Kontaktní osoba, mzda, další kroky…",
    saveApplication: "Zaznamenat odeslanou žádost",
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
    layoutLabel: "Zobrazení",
    listView: "Seznam",
    boardView: "Tabule",
    boardRegion: "Fáze přihlášek",
    boardPages: column => `${column}: stránky`,
    boardHint:
      "Kartu přetáhněte do jiné fáze, nebo použijte nabídku fáze přímo na kartě. Z uložené pozice se přihláška stane přes Zkontrolovat / označit odeslání, kde se zapíše skutečné datum odeslání.",
    boardColumnClosed: "Uzavřeno",
    boardColumnEmpty: "V této fázi zatím nic není.",
    boardMoveCard: (title: string) => `Přesunout ${title} do jiné fáze`,
    boardSavedNotDraggable: "Zatím neodesláno",
    followUpDue: "Připomenout teď",
    followUpOn: "Připomenout",
    contactLabel: "Kontakt ve firmě",
    contactName: "Jméno kontaktu",
    contactEmail: "E-mail kontaktu",
    manageTemplates: "Šablony",
    templatesTitle: "Šablony motivačních dopisů",
    templatesDescription:
      "Opakovaně použitelné dopisy, které načtete do kterékoli přihlášky.",
    newTemplate: "Nová šablona",
    editTemplate: "Upravit šablonu",
    templateName: "Název",
    templateSearch: "Hledat v názvech šablon",
    untitledTemplate: "Šablona bez názvu",
    emptyTemplate: "Prázdná šablona",
    noMatchingTemplates: "Žádná šablona neodpovídá hledání.",
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
    checkOffers: "Zkontrolovat nové nabídky",
    gateTitle: "Kariéra se načte, až o to požádáte",
    gateDescription: "Dokud nezkontrolujete, nic se nenačítá. Kontrola obnoví pracovní portály, ověří, které nabídky jsou stále otevřené, a načte uložené pozice, přihlášky a dopisy.",
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
