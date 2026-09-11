type AiStrings = {
  title: string;
  description: string;
  pricingLegend: string;
  pricingUnknown: string;
  allCategories: string;
  allPricing: string;
  sort: string;
  sortName: string;
  sortNewest: string;
  clearFilters: string;
  expandAll: string;
  collapseAll: string;
  expandDetails: string;
  collapseDetails: string;
  manageCategories: string;
  noDescription: string;
  duplicateLink: string;
  resultCount: (visible: number, total: number) => string;
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
  pricing: string;
  pricingNone: string;
  pricingLabel: { free: string; freemium: string; paid: string };
  autoFill: string;
  autoFillHint: string;
  enriching: string;
  enrichNeedsUrl: string;
  enrichFailed: string;
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
  linkCreated: string;
  linkSaved: string;
  linkDeleted: string;
  categoryCreated: string;
  categoryRenamed: string;
  categoryDeleted: string;
  // Empty states
  noLinksYet: string;
  noLinksDescription: string;
  noMatches: string;
  noMatchesDescription: string;
};

export const ai: { en: AiStrings; cs: AiStrings } = {
  en: {
    title: "Links",
    pricingLegend: "Pricing guide",
    pricingUnknown: "Pricing unverified",
    allCategories: "All categories",
    allPricing: "All pricing",
    sort: "Sort links",
    sortName: "Name A–Z",
    sortNewest: "Newest first",
    clearFilters: "Clear filters",
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    expandDetails: "Show details",
    collapseDetails: "Hide details",
    manageCategories: "Manage categories",
    noDescription: "Add a note about when to use this resource.",
    duplicateLink: "This URL is already in your library. Edit the existing link instead.",
    resultCount: (visible,total) => `${visible} of ${total} resources`,
    description: "Resources for building, designing and growing your projects. Expand a link for notes and sources.",
    addLink: "Add link",
    addCategory: "Add category",
    addCategoryPlaceholder: "Add category",
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
    newLinkTitle: "Add link",
    editLinkTitle: "Edit link",
    name: "Name",
    namePlaceholder: "e.g. Midjourney",
    url: "URL",
    urlPlaceholder: "https://…",
    descriptionLabel: "Description",
    descriptionPlaceholder: "What is it good for?",
    category: "Category",
    pricing: "Pricing",
    pricingNone: "Not set",
    pricingLabel: {
      free: "Fully free",
      freemium: "Free tier + paid",
      paid: "Paid only",
    },
    autoFill: "Auto-fill",
    autoFillHint: "Read the page and fill in the title, description, category and pricing.",
    enriching: "Reading…",
    enrichNeedsUrl: "Enter a URL first, then Auto-fill.",
    enrichFailed: "Couldn't read that page — fill the fields in manually.",
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
    couldNotSave: "Could not save the link. Please try again.",
    couldNotDelete: "Could not delete that. Please try again.",
    linkCreated: "Link added.",
    linkSaved: "Link saved.",
    linkDeleted: "Link deleted.",
    categoryCreated: "Category created.",
    categoryRenamed: "Category renamed.",
    categoryDeleted: "Category deleted.",
    noLinksYet: "No links yet",
    noLinksDescription: "Add a link to start your collection.",
    noMatches: "No matches",
    noMatchesDescription: "Try a different search.",
  },
  cs: {
    title: "Odkazy",
    pricingLegend: "Legenda cen",
    pricingUnknown: "Cena neověřena",
    allCategories: "Všechny kategorie",
    allPricing: "Všechny ceny",
    sort: "Řazení odkazů",
    sortName: "Název A–Z",
    sortNewest: "Nejnovější",
    clearFilters: "Zrušit filtry",
    expandAll: "Rozbalit vše",
    collapseAll: "Sbalit vše",
    expandDetails: "Zobrazit podrobnosti",
    collapseDetails: "Skrýt podrobnosti",
    manageCategories: "Správa kategorií",
    noDescription: "Doplňte poznámku, kdy se tento zdroj hodí.",
    duplicateLink: "Tuto URL už máte v knihovně. Upravte existující odkaz.",
    resultCount: (visible,total) => `${visible} z ${total} zdrojů`,
    description: "Zdroje pro vývoj, design a růst projektů. Rozbalením odkazu zobrazíte poznámky a zdroje.",
    addLink: "Přidat odkaz",
    addCategory: "Přidat kategorii",
    addCategoryPlaceholder: "Přidat kategorii",
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
    newLinkTitle: "Přidat odkaz",
    editLinkTitle: "Upravit odkaz",
    name: "Název",
    namePlaceholder: "např. Midjourney",
    url: "URL",
    urlPlaceholder: "https://…",
    descriptionLabel: "Popis",
    descriptionPlaceholder: "K čemu je to dobré?",
    category: "Kategorie",
    pricing: "Cena",
    pricingNone: "Neuvedeno",
    pricingLabel: {
      free: "Plně zdarma",
      freemium: "Zdarma i placené tarify",
      paid: "Pouze placené",
    },
    autoFill: "Doplnit",
    autoFillHint: "Načte stránku a doplní název, popis, kategorii a cenu.",
    enriching: "Načítání…",
    enrichNeedsUrl: "Nejprve zadej URL, pak Doplnit.",
    enrichFailed: "Stránku se nepodařilo načíst — vyplň pole ručně.",
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
    couldNotSave: "Odkaz se nepodařilo uložit. Zkuste to znovu.",
    couldNotDelete: "Nepodařilo se to smazat. Zkuste to znovu.",
    linkCreated: "Odkaz přidán.",
    linkSaved: "Odkaz uložen.",
    linkDeleted: "Odkaz smazán.",
    categoryCreated: "Kategorie vytvořena.",
    categoryRenamed: "Kategorie přejmenována.",
    categoryDeleted: "Kategorie smazána.",
    noLinksYet: "Zatím žádné odkazy",
    noLinksDescription: "Přidej odkaz a začni svou sbírku.",
    noMatches: "Žádné výsledky",
    noMatchesDescription: "Zkus jiné hledání.",
  },
};
