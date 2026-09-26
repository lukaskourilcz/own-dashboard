type ToolsStrings = {
  title: string;
  description: string;
  addTool: string;
  pickTool: string;
  pickToolDescription: string;
  editTool: string;
  newTool: (name: string) => string;
  name: string;
  namePlaceholder: (title: string) => string;
  whatItDoes: string;
  whatItDoesPlaceholder: string;
  whatItDoesRequired: string;
  status: string;
  statusLabel: Record<"in_use" | "trial" | "retired", string>;
  subscription: string;
  noSubscription: string;
  subscriptionHint: string;
  usedIn: string;
  usedInHint: string;
  notUsedYet: string;
  addProject: string;
  projectNote: (project: string) => string;
  removeProject: (project: string) => string;
  openLink: string;
  showInLibrary: string;
  markRetired: string;
  markInUse: string;
  deleteTool: string;
  deleteToolConfirm: string;
  monthly: (amount: string) => string;
  allProjects: string;
  projectFilter: string;
  noTools: string;
  noToolsDescription: string;
  noToolsForProject: string;
  saved: string;
  created: string;
  deleted: string;
  couldNotSave: string;
  signInFirst: string;
  save: string;
  cancel: string;
  count: (n: number) => string;
  manualEmpty: string;
  manualEmptyDescription: string;
  filterTools: string;
  detectedTitle: string;
  detectedDescription: string;
  autoDetected: string;
  fromPackageJson: string;
  checkAgain: string;
  checking: string;
  checkedAt: (time: string) => string;
  detectedLoading: string;
  detectedError: string;
  detectedRateLimited: string;
  detectedDisconnected: string;
  detectedEmpty: string;
  detectedNoRepositories: string;
  detectedNoMatches: string;
  howEachUses: string;
  alsoInRepositories: (projects: string) => string;
  repositories: (total: number, read: number) => string;
  repositoryStatus: {
    ok: (count: number, source: string) => string;
    empty: (source: string) => string;
    "not-found": string;
    unreadable: string;
    error: string;
    "no-repository": string;
    inherited: (parent: string) => string;
    skipped: (limit: number) => string;
  };
};

export const tools: { en: ToolsStrings; cs: ToolsStrings } = {
  en: {
    title: "Tools",
    description: "The tools your active projects use, found in each repository, and the library links you track by hand with their status and cost.",
    addTool: "Add tool",
    pickTool: "Choose a library link",
    pickToolDescription: "Tools are links from the library. Choose one, then describe it.",
    editTool: "Edit tool",
    newTool: (name) => `New tool: ${name}`,
    name: "Name",
    namePlaceholder: (title) => `Defaults to ${title}`,
    whatItDoes: "What it does",
    whatItDoesPlaceholder: "One or two sentences on what this tool does for you.",
    whatItDoesRequired: "Describe what the tool does.",
    status: "Status",
    statusLabel: { in_use: "In use", trial: "Trial", retired: "Retired" },
    subscription: "Subscription",
    noSubscription: "No subscription",
    subscriptionHint: "The monthly cost comes from the linked subscription.",
    usedIn: "Used in",
    usedInHint: "How the tool helps each project. Saved as the project's links with the role Tool.",
    notUsedYet: "Not linked to a project yet.",
    addProject: "Add project",
    projectNote: (project) => `How it helps ${project}`,
    removeProject: (project) => `Remove ${project}`,
    openLink: "Open link",
    showInLibrary: "Show in Links",
    markRetired: "Mark retired",
    markInUse: "Mark in use",
    deleteTool: "Delete tool",
    deleteToolConfirm: "Delete this tool? The library link stays, and so do its project links.",
    monthly: (amount) => `${amount}/mo`,
    allProjects: "All projects",
    projectFilter: "Filter by project",
    noTools: "No tools yet",
    noToolsDescription: "Add the services you really use from the Links library.",
    noToolsForProject: "No tools are linked to this project.",
    saved: "Tool saved.",
    created: "Tool added.",
    deleted: "Tool deleted.",
    couldNotSave: "Could not save the tool.",
    signInFirst: "Sign in first.",
    save: "Save",
    cancel: "Cancel",
    count: (n) => `${n} tool${n === 1 ? "" : "s"}`,
    manualEmpty: "No tools added by hand yet",
    manualEmptyDescription: "Add a library link as a tool to track its status and monthly cost. The tools your repositories list are below.",
    filterTools: "Filter tools",
    detectedTitle: "Found in repositories",
    detectedDescription:
      "Read from each active project's about-project.md (Tech stack and Third-party libraries), or from the dependencies in its package.json when that file lists nothing. Nothing is stored: the repositories stay the source.",
    autoDetected: "Auto-detected",
    fromPackageJson: "Runtime dependency in package.json",
    checkAgain: "Check the repositories again",
    checking: "Checking…",
    checkedAt: (time) => `Checked at ${time}`,
    detectedLoading: "Reading the active projects' repositories…",
    detectedError: "Could not read the repositories. Check again in a moment.",
    detectedRateLimited: "The repositories were checked too often. Try again in a minute.",
    detectedDisconnected:
      "GitHub is not connected, so the repositories cannot be read. Connect it from any project's Repository tab, then check again.",
    detectedEmpty:
      "The active projects' repositories list no tools yet. Add ## Tech stack and ## Third-party libraries to each about-project.md, one line per tool: Name — what it does.",
    detectedNoRepositories: "No active project has a GitHub repository linked.",
    detectedNoMatches: "No tool found in the repositories matches.",
    howEachUses: "How each project uses it",
    alsoInRepositories: (projects) => `Also listed in the repositories of ${projects}`,
    repositories: (total, read) => `Repositories: ${read} of ${total} active project${total === 1 ? "" : "s"} read`,
    repositoryStatus: {
      ok: (count, source) => `${count} tool${count === 1 ? "" : "s"} from ${source}`,
      empty: (source) => `${source} lists no tools`,
      "not-found": "No about-project.md or package.json",
      unreadable: "GitHub does not show this repository to the connected account",
      error: "Could not be read this time",
      "no-repository": "No GitHub repository linked",
      inherited: (parent) => `Part of the ${parent} repository`,
      skipped: (limit) => `Not read: only the first ${limit} repositories are checked`,
    },
  },
  cs: {
    title: "Nástroje",
    description: "Nástroje, které používají aktivní projekty, zjištěné z jejich repozitářů, a odkazy z knihovny, které sledujete ručně i se stavem a cenou.",
    addTool: "Přidat nástroj",
    pickTool: "Vyberte odkaz z knihovny",
    pickToolDescription: "Nástroje jsou odkazy z knihovny. Vyberte jeden a popište ho.",
    editTool: "Upravit nástroj",
    newTool: (name) => `Nový nástroj: ${name}`,
    name: "Název",
    namePlaceholder: (title) => `Výchozí: ${title}`,
    whatItDoes: "Co dělá",
    whatItDoesPlaceholder: "Jedna nebo dvě věty o tom, co pro vás nástroj dělá.",
    whatItDoesRequired: "Popište, co nástroj dělá.",
    status: "Stav",
    statusLabel: { in_use: "Používá se", trial: "Zkušební", retired: "Vyřazený" },
    subscription: "Předplatné",
    noSubscription: "Bez předplatného",
    subscriptionHint: "Měsíční náklad se bere z propojeného předplatného.",
    usedIn: "Používá se v",
    usedInHint: "Jak nástroj pomáhá jednotlivým projektům. Ukládá se jako odkazy projektu s rolí Nástroj.",
    notUsedYet: "Zatím není propojený s projektem.",
    addProject: "Přidat projekt",
    projectNote: (project) => `Jak pomáhá projektu ${project}`,
    removeProject: (project) => `Odebrat ${project}`,
    openLink: "Otevřít odkaz",
    showInLibrary: "Zobrazit v odkazech",
    markRetired: "Označit jako vyřazený",
    markInUse: "Označit jako používaný",
    deleteTool: "Smazat nástroj",
    deleteToolConfirm: "Smazat tento nástroj? Odkaz v knihovně zůstane, stejně jako odkazy projektů.",
    monthly: (amount) => `${amount}/měs.`,
    allProjects: "Všechny projekty",
    projectFilter: "Filtrovat podle projektu",
    noTools: "Zatím žádné nástroje",
    noToolsDescription: "Přidejte služby z knihovny odkazů, které opravdu používáte.",
    noToolsForProject: "K tomuto projektu nejsou propojené žádné nástroje.",
    saved: "Nástroj uložen.",
    created: "Nástroj přidán.",
    deleted: "Nástroj smazán.",
    couldNotSave: "Nástroj se nepodařilo uložit.",
    signInFirst: "Nejprve se přihlaste.",
    save: "Uložit",
    cancel: "Zrušit",
    count: (n) => `${n} ${n === 1 ? "nástroj" : n >= 2 && n <= 4 ? "nástroje" : "nástrojů"}`,
    manualEmpty: "Zatím žádné ručně přidané nástroje",
    manualEmptyDescription: "Přidejte odkaz z knihovny jako nástroj a sledujte jeho stav a měsíční náklad. Nástroje uvedené v repozitářích jsou níže.",
    filterTools: "Filtrovat nástroje",
    detectedTitle: "Zjištěno z repozitářů",
    detectedDescription:
      "Načteno z about-project.md každého aktivního projektu (Tech stack a Third-party libraries), případně ze závislostí v package.json, když soubor nic neuvádí. Nic se neukládá: zdrojem zůstávají repozitáře.",
    autoDetected: "Zjištěno automaticky",
    fromPackageJson: "Běhová závislost v package.json",
    checkAgain: "Znovu zkontrolovat repozitáře",
    checking: "Kontroluji…",
    checkedAt: (time) => `Zkontrolováno v ${time}`,
    detectedLoading: "Čtu repozitáře aktivních projektů…",
    detectedError: "Repozitáře se nepodařilo načíst. Zkuste to za chvíli znovu.",
    detectedRateLimited: "Repozitáře se kontrolovaly příliš často. Zkuste to znovu za minutu.",
    detectedDisconnected:
      "GitHub není připojený, takže repozitáře nejde načíst. Připojte ho na záložce Repozitář u kteréhokoli projektu a zkontrolujte znovu.",
    detectedEmpty:
      "Repozitáře aktivních projektů zatím žádné nástroje neuvádějí. Doplňte do každého about-project.md sekce ## Tech stack a ## Third-party libraries, na každý řádek jeden nástroj: Název — co dělá.",
    detectedNoRepositories: "Žádný aktivní projekt nemá napojený GitHub repozitář.",
    detectedNoMatches: "Žádný nástroj z repozitářů neodpovídá.",
    howEachUses: "Jak ho používají jednotlivé projekty",
    alsoInRepositories: (projects) => `Uvedeno také v repozitářích projektů ${projects}`,
    repositories: (total, read) => `Repozitáře: načteno ${read} z ${total} ${total === 1 ? "aktivního projektu" : "aktivních projektů"}`,
    repositoryStatus: {
      ok: (count, source) => `${count} ${count === 1 ? "nástroj" : count >= 2 && count <= 4 ? "nástroje" : "nástrojů"} z ${source}`,
      empty: (source) => `${source} neuvádí žádné nástroje`,
      "not-found": "Chybí about-project.md i package.json",
      unreadable: "GitHub tento repozitář připojenému účtu nezobrazí",
      error: "Tentokrát se nepodařilo načíst",
      "no-repository": "Bez napojeného GitHub repozitáře",
      inherited: (parent) => `Součást repozitáře projektu ${parent}`,
      skipped: (limit) => `Nenačteno: kontroluje se jen prvních ${limit} repozitářů`,
    },
  },
};
