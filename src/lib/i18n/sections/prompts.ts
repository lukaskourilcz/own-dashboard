import type { PromptKind } from "@/lib/prompt-kinds";

type PromptsStrings = {
  title: string;
  description: string;
  newPrompt: string;
  searchPlaceholder: string;
  // Card
  copy: string;
  copied: string;
  couldNotCopy: string;
  edit: string;
  delete: string;
  deletePrompt: string;
  deleteConfirm: string;
  // Dialog / form
  newTitle: string;
  editTitle: string;
  name: string;
  namePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  noDescription: string;
  promptText: string;
  promptPlaceholder: string;
  project: string;
  noProject: string;
  cancel: string;
  create: string;
  save: string;
  saving: string;
  nameRequired: string;
  bodyRequired: string;
  signInFirst: string;
  couldNotSave: string;
  couldNotDelete: string;
  createdToast: string;
  savedToast: string;
  deletedToast: string;
  // Empty states
  noPromptsYet: string;
  noPromptsDescription: string;
  noMatches: string;
  noMatchesDescription: string;
  // Mine / Public subsections + curated import
  mineSection: string;
  publicSection: string;
  publicSectionDesc: string;
  addCurated: string;
  addingCurated: string;
  curatedAdded: (n: number) => string;
  curatedNoneNew: string;
  publicEmpty: string;
  makePublic: string;
  makePublicHint: string;
  kind: string;
  kindLabel: Record<PromptKind, string>;
  allKinds: string;
  kindFilter: string;
  publicBadge: string;
  defaultProject: string;
  defaultProjectHint: string;
  placeholdersHint: string;
  links: string;
  linksHint: string;
  addLinks: string;
  noLinks: string;
  linkNote: string;
  linkNotePlaceholder: string;
  removeLink: string;
  linkCount: (n: number) => string;
  copyWithContext: string;
  copyTitle: (name: string) => string;
  copyDescription: string;
  copyProject: string;
  copyNoProject: string;
  copyPreview: string;
  copyAction: string;
  couldNotCopyManual: string;
  linksSaveFailed: string;
  curatedSection: string;
  curatedHint: string;
  groupCount: (n: number) => string;
  workspacePromptsInfo: string;
};

export const prompts: { en: PromptsStrings; cs: PromptsStrings } = {
  en: {
    title: "Prompts",
    description: "Universal prompts grouped by the kind of job, each with the links an agent should open.",
    newPrompt: "New prompt",
    searchPlaceholder: "Search prompts…",
    copy: "Copy to clipboard",
    copied: "Copied to clipboard",
    couldNotCopy: "Could not copy to clipboard.",
    edit: "Edit",
    delete: "Delete",
    deletePrompt: "Delete prompt",
    deleteConfirm: "Delete this prompt? This cannot be undone.",
    newTitle: "New prompt",
    editTitle: "Edit prompt",
    name: "Name",
    namePlaceholder: "e.g. Code review",
    descriptionLabel: "Description",
    descriptionPlaceholder: "Briefly, what this prompt does",
    noDescription: "No description yet",
    promptText: "Prompt",
    promptPlaceholder: "Paste or write your prompt…",
    project: "Project",
    noProject: "No linked project",
    cancel: "Cancel",
    create: "Create",
    save: "Save",
    saving: "Saving…",
    nameRequired: "Name is required.",
    bodyRequired: "Prompt text is required.",
    signInFirst: "Sign in first.",
    couldNotSave: "Could not save the prompt. Please try again.",
    couldNotDelete: "Could not delete the prompt. Please try again.",
    createdToast: "Prompt created.",
    savedToast: "Prompt saved.",
    deletedToast: "Prompt deleted.",
    noPromptsYet: "No prompts yet",
    noPromptsDescription: "Add a prompt to start building your library.",
    noMatches: "No matches",
    noMatchesDescription: "Try a different search.",
    mineSection: "Mine",
    publicSection: "Public",
    publicSectionDesc: "Curated prompts scouted for your work — edit or delete like your own.",
    addCurated: "Add curated prompts",
    addingCurated: "Adding…",
    curatedAdded: (n) => `Added ${n} curated prompt${n === 1 ? "" : "s"}.`,
    curatedNoneNew: "All curated prompts are already in your library.",
    publicEmpty: "No public prompts yet.",
    makePublic: "Public prompt",
    makePublicHint: "Marks a curated or shared prompt with a Public badge.",
    kind: "Kind of job",
    kindLabel: { design: "Design", audit: "Audit", competition: "Competition", "ux-ui": "UX & UI", analysis: "Analysis", documentation: "Documentation", "new-project": "New project", seo: "SEO", marketing: "Marketing", other: "Other" },
    allKinds: "All kinds",
    kindFilter: "Filter by kind",
    publicBadge: "Public",
    defaultProject: "Default project",
    defaultProjectHint: "Preselected when copying. The prompt itself stays universal.",
    placeholdersHint: "Placeholders: {{project.name}}, {{project.repo}}, {{project.url}}, {{project.dev_url}}.",
    links: "Links",
    linksHint: "Library links an agent should open for this prompt.",
    addLinks: "Add links",
    noLinks: "No links yet.",
    linkNote: "Note",
    linkNotePlaceholder: "Why to open it",
    removeLink: "Remove link",
    linkCount: (n) => `${n} link${n === 1 ? "" : "s"}`,
    copyWithContext: "Copy with project and links",
    copyTitle: (name) => `Copy: ${name}`,
    copyDescription: "Choose a project to expand the placeholders and add its block and links. Review the text, then copy it.",
    copyProject: "Project",
    copyNoProject: "No project (keep placeholders)",
    copyPreview: "Preview",
    copyAction: "Copy",
    couldNotCopyManual: "Could not copy. Select the preview text and copy it manually.",
    linksSaveFailed: "The prompt was saved, but its links could not be updated.",
    curatedSection: "Curated prompts",
    curatedHint: "Universal prompts for each kind of job. Adding them skips names already in your library.",
    groupCount: (n) => `${n} prompt${n === 1 ? "" : "s"}`,
    workspacePromptsInfo: "Every prompt, grouped by kind. Copying fills in this project and its links.",
  },
  cs: {
    title: "Prompty",
    description: "Univerzální prompty podle druhu práce, každý s odkazy, které má agent otevřít.",
    newPrompt: "Nový prompt",
    searchPlaceholder: "Hledat prompty…",
    copy: "Kopírovat do schránky",
    copied: "Zkopírováno do schránky",
    couldNotCopy: "Nepodařilo se zkopírovat do schránky.",
    edit: "Upravit",
    delete: "Smazat",
    deletePrompt: "Smazat prompt",
    deleteConfirm: "Smazat tento prompt? Tuto akci nelze vrátit zpět.",
    newTitle: "Nový prompt",
    editTitle: "Upravit prompt",
    name: "Název",
    namePlaceholder: "např. Code review",
    descriptionLabel: "Popis",
    descriptionPlaceholder: "Stručně, co tento prompt dělá",
    noDescription: "Zatím bez popisu",
    promptText: "Prompt",
    promptPlaceholder: "Vlož nebo napiš svůj prompt…",
    project: "Projekt",
    noProject: "Bez propojeného projektu",
    cancel: "Zrušit",
    create: "Vytvořit",
    save: "Uložit",
    saving: "Ukládání…",
    nameRequired: "Název je povinný.",
    bodyRequired: "Text promptu je povinný.",
    signInFirst: "Nejprve se přihlaste.",
    couldNotSave: "Prompt se nepodařilo uložit. Zkuste to znovu.",
    couldNotDelete: "Prompt se nepodařilo smazat. Zkuste to znovu.",
    createdToast: "Prompt vytvořen.",
    savedToast: "Prompt uložen.",
    deletedToast: "Prompt smazán.",
    noPromptsYet: "Zatím žádné prompty",
    noPromptsDescription: "Přidej prompt a začni budovat svou knihovnu.",
    noMatches: "Žádné výsledky",
    noMatchesDescription: "Zkus jiné hledání.",
    mineSection: "Moje",
    publicSection: "Veřejné",
    publicSectionDesc: "Doporučené prompty vybrané pro tvou práci — uprav nebo smaž jako vlastní.",
    addCurated: "Přidat doporučené",
    addingCurated: "Přidávám…",
    curatedAdded: (n) => {
      if (n === 1) return "Přidán 1 doporučený prompt.";
      if (n >= 2 && n <= 4) return `Přidány ${n} doporučené prompty.`;
      return `Přidáno ${n} doporučených promptů.`;
    },
    curatedNoneNew: "Všechny doporučené prompty už v knihovně máš.",
    publicEmpty: "Zatím žádné veřejné prompty.",
    makePublic: "Veřejný prompt",
    makePublicHint: "Označí vybraný nebo sdílený prompt štítkem Veřejný.",
    kind: "Druh pr\u00e1ce",
    kindLabel: { design: "Návrh designu", audit: "Audit projektu", competition: "Konkurence", "ux-ui": "Kontrola UX a UI", analysis: "Analýza projektu", documentation: "Dokumentace", "new-project": "Nový projekt z nápadu", seo: "SEO", marketing: "Marketing", other: "Ostatní" },
    allKinds: "V\u0161echny druhy",
    kindFilter: "Filtrovat podle druhu",
    publicBadge: "Ve\u0159ejn\u00fd",
    defaultProject: "V\u00fdchoz\u00ed projekt",
    defaultProjectHint: "P\u0159edvybran\u00fd p\u0159i kop\u00edrov\u00e1n\u00ed. Prompt s\u00e1m z\u016fst\u00e1v\u00e1 univerz\u00e1ln\u00ed.",
    placeholdersHint: "Z\u00e1stupn\u00e9 znaky: {{project.name}}, {{project.repo}}, {{project.url}}, {{project.dev_url}}.",
    links: "Odkazy",
    linksHint: "Odkazy z knihovny, kter\u00e9 m\u00e1 agent k promptu otev\u0159\u00edt.",
    addLinks: "P\u0159idat odkazy",
    noLinks: "Zat\u00edm \u017e\u00e1dn\u00e9 odkazy.",
    linkNote: "Pozn\u00e1mka",
    linkNotePlaceholder: "Pro\u010d ho otev\u0159\u00edt",
    removeLink: "Odebrat odkaz",
    linkCount: (n) => `${n} ${n === 1 ? "odkaz" : n < 5 ? "odkazy" : "odkazů"}`,
    copyWithContext: "Kop\u00edrovat s projektem a odkazy",
    copyTitle: (name) => `Kopírovat: ${name}`,
    copyDescription: "Vyberte projekt, kter\u00fd dopln\u00ed z\u00e1stupn\u00e9 znaky, blok projektu a jeho odkazy. Zkontrolujte text a zkop\u00edrujte ho.",
    copyProject: "Projekt",
    copyNoProject: "Bez projektu (ponechat z\u00e1stupn\u00e9 znaky)",
    copyPreview: "N\u00e1hled",
    copyAction: "Kop\u00edrovat",
    couldNotCopyManual: "Kop\u00edrov\u00e1n\u00ed se nezda\u0159ilo. Ozna\u010dte text n\u00e1hledu a zkop\u00edrujte ho ru\u010dn\u011b.",
    linksSaveFailed: "Prompt se ulo\u017eil, ale jeho odkazy se nepoda\u0159ilo upravit.",
    curatedSection: "Vybran\u00e9 prompty",
    curatedHint: "Univerz\u00e1ln\u00ed prompty pro ka\u017ed\u00fd druh pr\u00e1ce. P\u0159id\u00e1n\u00ed p\u0159esko\u010d\u00ed n\u00e1zvy, kter\u00e9 u\u017e v knihovn\u011b m\u00e1te.",
    groupCount: (n) => `${n} ${n === 1 ? "prompt" : n < 5 ? "prompty" : "promptů"}`,
    workspacePromptsInfo: "V\u0161echny prompty podle druhu. Kop\u00edrov\u00e1n\u00ed dopln\u00ed tento projekt a jeho odkazy.",
  },
};
