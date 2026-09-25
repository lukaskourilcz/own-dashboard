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
    kind: "Druh práce",
    kindLabel: { design: "Návrh designu", audit: "Audit projektu", competition: "Konkurence", "ux-ui": "Kontrola UX a UI", analysis: "Analýza projektu", documentation: "Dokumentace", "new-project": "Nový projekt z nápadu", seo: "SEO", marketing: "Marketing", other: "Ostatní" },
    allKinds: "Všechny druhy",
    kindFilter: "Filtrovat podle druhu",
    publicBadge: "Veřejný",
    defaultProject: "Výchozí projekt",
    defaultProjectHint: "Předvybraný při kopírování. Prompt sám zůstává univerzální.",
    placeholdersHint: "Zástupné znaky: {{project.name}}, {{project.repo}}, {{project.url}}, {{project.dev_url}}.",
    links: "Odkazy",
    linksHint: "Odkazy z knihovny, které má agent k promptu otevřít.",
    addLinks: "Přidat odkazy",
    noLinks: "Zatím žádné odkazy.",
    linkNote: "Poznámka",
    linkNotePlaceholder: "Proč ho otevřít",
    removeLink: "Odebrat odkaz",
    linkCount: (n) => `${n} ${n === 1 ? "odkaz" : n < 5 ? "odkazy" : "odkazů"}`,
    copyWithContext: "Kopírovat s projektem a odkazy",
    copyTitle: (name) => `Kopírovat: ${name}`,
    copyDescription: "Vyberte projekt, který doplní zástupné znaky, blok projektu a jeho odkazy. Zkontrolujte text a zkopírujte ho.",
    copyProject: "Projekt",
    copyNoProject: "Bez projektu (ponechat zástupné znaky)",
    copyPreview: "Náhled",
    copyAction: "Kopírovat",
    couldNotCopyManual: "Kopírování se nezdařilo. Označte text náhledu a zkopírujte ho ručně.",
    linksSaveFailed: "Prompt se uložil, ale jeho odkazy se nepodařilo upravit.",
    curatedSection: "Vybrané prompty",
    curatedHint: "Univerzální prompty pro každý druh práce. Přidání přeskočí názvy, které už v knihovně máte.",
    groupCount: (n) => `${n} ${n === 1 ? "prompt" : n < 5 ? "prompty" : "promptů"}`,
    workspacePromptsInfo: "Všechny prompty podle druhu. Kopírování doplní tento projekt a jeho odkazy.",
  },
};
