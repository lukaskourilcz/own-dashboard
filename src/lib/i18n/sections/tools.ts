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
};

export const tools: { en: ToolsStrings; cs: ToolsStrings } = {
  en: {
    title: "Tools",
    description: "The library links really in use: what each tool does and how it helps each project.",
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
  },
  cs: {
    title: "Nástroje",
    description: "Odkazy z knihovny, které opravdu používáte: co každý nástroj dělá a jak pomáhá jednotlivým projektům.",
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
    count: (n) => `${n} ${n === 1 ? "nástroj" : n < 5 ? "nástroje" : "nástrojů"}`,
  },
};
