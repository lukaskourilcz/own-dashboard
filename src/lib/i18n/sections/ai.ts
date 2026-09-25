type AiStrings = {
  exportTitle: string;
  exportLinksTitle: string;
  exportIdeasTitle: string;
  exportHint: string;
  exportFormat: string;
  exportSelection: string;
  exportSelectionAll: string;
  exportSelectionCategories: string;
  exportSelectionLinks: string;
  exportSelectionIdeas: string;
  exportChooseCategories: string;
  exportChooseLinks: string;
  exportChooseIdeas: string;
  exportFree: string;
  exportFreemium: string;
  exportFreemiumOnly: string;
  exportPaid: string;
  exportUnknown: string;
  exportAll: string;
  exportShape: string;
  exportShapeDetailed: string;
  exportShapeCompact: string;
  exportShapeGrouped: string;
  exportPreview: string;
  exportDownload: string;
  exportCopy: string;
  exportCopied: string;
  exportCopyFailed: string;
  ideasTitle: string;
  editIdeaTitle: string;
  ideaEmpty: string;
  pricingEvidence: string;
  unknownPricing: string;
  ideasHint: string;
  addIdea: string;
  rating: string;
  relevance: string;
  sources: string;
  ideaSummary: string;
  ideaBenefit: string;
  originalReels: string;
  reel: string;
  source: string;
  recordType: string;
  linkType: string;
  ideaType: string;
  exportCount: (count: number) => string;
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
  usedBy: string;
  usedByMore: (n: number) => string;
  addToProject: string;
  addToProjectDescription: string;
  project: string;
  allProjects: string;
  relationNote: string;
  relationNotePlaceholder: string;
  relationRole: string;
  roleLabel: Record<"uses" | "reference" | "tool", string>;
  relationAdded: string;
  relationSaved: string;
  relationRemoved: string;
  relationFailed: string;
  allProjectsLinked: string;
  pickerTitle: string;
  pickerDescription: string;
  pickerSingleDescription: string;
  pickerAdd: (n: number) => string;
  pickerEmpty: string;
  pickerShowMore: (shown: number, total: number) => string;
  pickerResults: (n: number) => string;
  toolBadge: string;
  projectFilterLabel: string;
};

export const ai: { en: AiStrings; cs: AiStrings } = {
  en: {
    exportTitle: "Copy to JSON / Markdown",
    exportLinksTitle: "Copy links to JSON / Markdown",
    exportIdeasTitle: "Copy ideas to JSON / Markdown",
    exportHint: "Choose all records, selected categories or individual records, then apply an optional pricing filter.",
    exportFormat: "Format",
    exportSelection: "Include",
    exportSelectionAll: "All categories",
    exportSelectionCategories: "Selected categories",
    exportSelectionLinks: "Selected links",
    exportSelectionIdeas: "Selected ideas",
    exportChooseCategories: "Choose categories",
    exportChooseLinks: "Choose links",
    exportChooseIdeas: "Choose ideas",
    exportFree: "Free only",
    exportFreemium: "Free + partially paid (freemium)",
    exportFreemiumOnly: "Freemium only",
    exportPaid: "Paid only",
    exportUnknown: "Pricing unverified",
    exportAll: "All",
    exportShape: "JSON structure",
    exportShapeDetailed: "Detailed flat list",
    exportShapeCompact: "Compact flat list",
    exportShapeGrouped: "Grouped by category",
    exportPreview: "Preview",
    exportDownload: "Download file",
    exportCopy: "Copy all content",
    exportCopied: "Copied to clipboard.",
    exportCopyFailed: "Could not copy. Select the preview text and copy it manually.",
    ideasTitle: "Ideas",
    editIdeaTitle: "Edit idea",
    ideaEmpty: "No ideas here yet. Add advice and its source to get started.",
    pricingEvidence: "Pricing evidence",
    unknownPricing: "Price unverified",
    ideasHint: "Practical advice, grouped by topic, with sources and project relevance.",
    addIdea: "Add idea",
    rating: "Usefulness",
    relevance: "Projects that benefit",
    sources: "Sources",
    ideaSummary: "What the Reel was about",
    ideaBenefit: "Why this idea is useful",
    originalReels: "Original source or Reel",
    reel: "Reel",
    source: "Source",
    recordType: "Type",
    linkType: "Link",
    ideaType: "Idea",
    exportCount: (count) => `${count} items`,

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
    searchPlaceholder: "Search links and ideas…",
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
    usedBy: "Used by",
    usedByMore: (n) => `+${n} more`,
    addToProject: "Add to project",
    addToProjectDescription: "Record that a project uses this link and how it helps.",
    project: "Project",
    allProjects: "All projects",
    relationNote: "How it helps",
    relationNotePlaceholder: "What this project uses it for\u2026",
    relationRole: "Role",
    roleLabel: { uses: "Uses", reference: "Reference", tool: "Tool" },
    relationAdded: "Added to the project.",
    relationSaved: "Saved.",
    relationRemoved: "Removed from the project.",
    relationFailed: "Could not update the project links.",
    allProjectsLinked: "Every active project already uses this link.",
    pickerTitle: "Add links",
    pickerDescription: "Search the library and choose one or more links.",
    pickerSingleDescription: "Search the library and choose one link.",
    pickerAdd: (n) => (n > 0 ? `Add ${n}` : "Add"),
    pickerEmpty: "No library links match.",
    pickerShowMore: (shown, total) => `Show more (${shown} of ${total})`,
    pickerResults: (n) => `${n} link${n === 1 ? "" : "s"}`,
    toolBadge: "Tool",
    projectFilterLabel: "Used by project",
  },
  cs: {
    exportTitle: "Kopírovat do JSON / Markdown",
    exportLinksTitle: "Kopírovat odkazy do JSON / Markdown",
    exportIdeasTitle: "Kopírovat nápady do JSON / Markdown",
    exportHint: "Vyberte všechny záznamy, konkrétní kategorie nebo jednotlivé položky a případně je omezte podle ceny.",
    exportFormat: "Formát",
    exportSelection: "Zahrnout",
    exportSelectionAll: "Všechny kategorie",
    exportSelectionCategories: "Vybrané kategorie",
    exportSelectionLinks: "Vybrané odkazy",
    exportSelectionIdeas: "Vybrané nápady",
    exportChooseCategories: "Vybrat kategorie",
    exportChooseLinks: "Vybrat odkazy",
    exportChooseIdeas: "Vybrat nápady",
    exportFree: "Pouze zdarma",
    exportFreemium: "Zdarma + částečně placené",
    exportFreemiumOnly: "Pouze freemium",
    exportPaid: "Pouze placené",
    exportUnknown: "Cena neověřena",
    exportAll: "Vše",
    exportShape: "Struktura JSON",
    exportShapeDetailed: "Podrobný plochý seznam",
    exportShapeCompact: "Stručný plochý seznam",
    exportShapeGrouped: "Seskupit podle kategorií",
    exportPreview: "Náhled",
    exportDownload: "Stáhnout soubor",
    exportCopy: "Kopírovat celý obsah",
    exportCopied: "Zkopírováno do schránky.",
    exportCopyFailed: "Kopírování se nezdařilo. Označte text náhledu a zkopírujte jej ručně.",
    ideasTitle: "Nápady",
    editIdeaTitle: "Upravit nápad",
    ideaEmpty: "Zatím tu nejsou žádné nápady. Přidejte radu a její zdroj.",
    pricingEvidence: "Podklady k ceně",
    unknownPricing: "Cena neověřena",
    ideasHint: "Praktické rady podle tématu, se zdroji a využitím v projektech.",
    addIdea: "Přidat nápad",
    rating: "Užitečnost",
    relevance: "Využití v projektech",
    sources: "Zdroje",
    ideaSummary: "O čem Reel byl",
    ideaBenefit: "Proč je nápad užitečný",
    originalReels: "Původní zdroj nebo Reel",
    reel: "Reel",
    source: "Zdroj",
    recordType: "Typ",
    linkType: "Odkaz",
    ideaType: "Nápad",
    exportCount: (count) => `${count} položek`,

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
    searchPlaceholder: "Hledat odkazy a nápady…",
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
    usedBy: "Pou\u017e\u00edv\u00e1",
    usedByMore: (n) => `+${n} další`,
    addToProject: "P\u0159idat k projektu",
    addToProjectDescription: "Zaznamenejte, \u017ee projekt odkaz pou\u017e\u00edv\u00e1 a jak mu pom\u00e1h\u00e1.",
    project: "Projekt",
    allProjects: "V\u0161echny projekty",
    relationNote: "Jak pom\u00e1h\u00e1",
    relationNotePlaceholder: "K \u010demu ho projekt pou\u017e\u00edv\u00e1\u2026",
    relationRole: "Role",
    roleLabel: { uses: "Používá", reference: "Reference", tool: "Nástroj" },
    relationAdded: "P\u0159id\u00e1no k projektu.",
    relationSaved: "Ulo\u017eeno.",
    relationRemoved: "Odebr\u00e1no z projektu.",
    relationFailed: "Odkazy projektu se nepoda\u0159ilo upravit.",
    allProjectsLinked: "V\u0161echny aktivn\u00ed projekty u\u017e tento odkaz pou\u017e\u00edvaj\u00ed.",
    pickerTitle: "P\u0159idat odkazy",
    pickerDescription: "Vyhledejte v knihovn\u011b a vyberte jeden nebo v\u00edce odkaz\u016f.",
    pickerSingleDescription: "Vyhledejte v knihovn\u011b a vyberte jeden odkaz.",
    pickerAdd: (n) => (n > 0 ? `Přidat ${n}` : "Přidat"),
    pickerEmpty: "\u017d\u00e1dn\u00fd odkaz z knihovny neodpov\u00edd\u00e1.",
    pickerShowMore: (shown, total) => `Zobrazit další (${shown} z ${total})`,
    pickerResults: (n) => `${n} ${n === 1 ? "odkaz" : n < 5 ? "odkazy" : "odkazů"}`,
    toolBadge: "N\u00e1stroj",
    projectFilterLabel: "Pou\u017e\u00edv\u00e1 projekt",
  },
};
