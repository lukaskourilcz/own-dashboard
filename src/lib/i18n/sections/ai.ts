type AiStrings = {
  title: string;
  description: string;
  // Toolbar
  addLink: string;
  addCategory: string;
  addCategoryPlaceholder: string;
  add: string;
  searchPlaceholder: string;
  // Table columns
  colSite: string;
  colDescription: string;
  colActions: string;
  open: string;
  visit: string;
  // Categories
  uncategorized: string;
  renameCategory: string;
  deleteCategory: string;
  deleteCategoryConfirm: (name: string) => string;
  categoryEmpty: string;
  manageHint: string;
  // Link dialog / form
  newLinkTitle: string;
  editLinkTitle: string;
  name: string;
  namePlaceholder: string;
  url: string;
  urlPlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  category: string;
  cancel: string;
  create: string;
  save: string;
  saving: string;
  edit: string;
  delete: string;
  deleteLink: string;
  deleteLinkConfirm: string;
  // Validation / errors
  nameRequired: string;
  urlRequired: string;
  urlInvalid: string;
  categoryNameRequired: string;
  signInFirst: string;
  couldNotSave: string;
  couldNotDelete: string;
  // Empty states
  noLinksYet: string;
  noLinksDescription: string;
  noMatches: string;
  noMatchesDescription: string;
};

export const ai: { en: AiStrings; cs: AiStrings } = {
  en: {
    title: "AI links",
    description: "AI sites and tools you've discovered, organized your way.",
    addLink: "Add link",
    addCategory: "Add category",
    addCategoryPlaceholder: "New category, e.g. DESIGN",
    add: "Add",
    searchPlaceholder: "Search links…",
    colSite: "Site",
    colDescription: "Description",
    colActions: "Actions",
    open: "Open link",
    visit: "Visit",
    uncategorized: "Uncategorized",
    renameCategory: "Rename category",
    deleteCategory: "Delete category",
    deleteCategoryConfirm: (name) =>
      `Delete the "${name}" category? Its links move to Uncategorized.`,
    categoryEmpty: "No links here yet.",
    manageHint: "Create categories like DESIGN, SECURITY, IDEAS to group links.",
    newLinkTitle: "Add AI link",
    editLinkTitle: "Edit AI link",
    name: "Name",
    namePlaceholder: "e.g. Midjourney",
    url: "URL",
    urlPlaceholder: "https://…",
    descriptionLabel: "Description",
    descriptionPlaceholder: "What is it good for?",
    category: "Category",
    cancel: "Cancel",
    create: "Create",
    save: "Save",
    saving: "Saving…",
    edit: "Edit",
    delete: "Delete",
    deleteLink: "Delete link",
    deleteLinkConfirm: "Delete this link? This cannot be undone.",
    nameRequired: "Name is required.",
    urlRequired: "URL is required.",
    urlInvalid: "Enter a valid URL (https://…).",
    categoryNameRequired: "Category name is required.",
    signInFirst: "Sign in first.",
    couldNotSave: "Could not save link.",
    couldNotDelete: "Could not delete.",
    noLinksYet: "No AI links yet",
    noLinksDescription: "Add a link to start your collection.",
    noMatches: "No matches",
    noMatchesDescription: "Try a different search.",
  },
  cs: {
    title: "AI links",
    description: "AI weby a nástroje, které jsi objevil, uspořádané po svém.",
    addLink: "Přidat odkaz",
    addCategory: "Přidat kategorii",
    addCategoryPlaceholder: "Nová kategorie, např. DESIGN",
    add: "Přidat",
    searchPlaceholder: "Hledat odkazy…",
    colSite: "Web",
    colDescription: "Popis",
    colActions: "Akce",
    open: "Otevřít odkaz",
    visit: "Otevřít",
    uncategorized: "Bez kategorie",
    renameCategory: "Přejmenovat kategorii",
    deleteCategory: "Smazat kategorii",
    deleteCategoryConfirm: (name) =>
      `Smazat kategorii „${name}“? Její odkazy se přesunou do Bez kategorie.`,
    categoryEmpty: "Zatím tu nejsou žádné odkazy.",
    manageHint: "Vytvoř kategorie jako DESIGN, SECURITY, IDEAS pro seskupení odkazů.",
    newLinkTitle: "Přidat AI odkaz",
    editLinkTitle: "Upravit AI odkaz",
    name: "Název",
    namePlaceholder: "např. Midjourney",
    url: "URL",
    urlPlaceholder: "https://…",
    descriptionLabel: "Popis",
    descriptionPlaceholder: "K čemu je to dobré?",
    category: "Kategorie",
    cancel: "Zrušit",
    create: "Vytvořit",
    save: "Uložit",
    saving: "Ukládání…",
    edit: "Upravit",
    delete: "Smazat",
    deleteLink: "Smazat odkaz",
    deleteLinkConfirm: "Smazat tento odkaz? Tuto akci nelze vrátit zpět.",
    nameRequired: "Název je povinný.",
    urlRequired: "URL je povinná.",
    urlInvalid: "Zadej platnou URL (https://…).",
    categoryNameRequired: "Název kategorie je povinný.",
    signInFirst: "Nejprve se přihlaste.",
    couldNotSave: "Odkaz se nepodařilo uložit.",
    couldNotDelete: "Nepodařilo se smazat.",
    noLinksYet: "Zatím žádné AI odkazy",
    noLinksDescription: "Přidej odkaz a začni svou sbírku.",
    noMatches: "Žádné výsledky",
    noMatchesDescription: "Zkus jiné hledání.",
  },
};
