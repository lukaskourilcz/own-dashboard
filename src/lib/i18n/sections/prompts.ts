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
};

export const prompts: { en: PromptsStrings; cs: PromptsStrings } = {
  en: {
    title: "Prompts",
    description: "Your reusable prompt library — click a card to copy it.",
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
  },
  cs: {
    title: "Prompty",
    description: "Tvoje knihovna promptů — kliknutím na kartu ji zkopíruješ.",
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
  },
};
