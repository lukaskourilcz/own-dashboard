import type { TipGroupKey } from "@/lib/ig-tips";

type TipsStrings = {
  title: string;
  description: string;
  addTip: string;
  searchPlaceholder: string;
  groupFilter: string;
  allGroups: string;
  groupLabel: Record<TipGroupKey, string>;
  count: (n: number) => string;
  resultCount: (visible: number, total: number) => string;
  clearFilters: string;
  sourceInstagram: (n: number) => string;
  sourceWeb: (host: string) => string;
  forProjects: (names: string) => string;
  noSummary: string;
  details: string;
  hideDetails: string;
  openOriginal: string;
  opensInNewTab: string;
  edit: string;
  delete: string;
  notes: string;
  whyUseful: string;
  usefulness: (n: number) => string;
  projectsThatBenefit: string;
  sources: string;
  newTitle: string;
  editTitle: string;
  titleLabel: string;
  urlLabel: string;
  groupField: string;
  noGroup: string;
  summaryLabel: string;
  summaryHint: string;
  notesLabel: string;
  notesHint: string;
  titleRequired: string;
  urlRequired: string;
  urlInvalid: string;
  duplicate: string;
  save: string;
  create: string;
  saving: string;
  cancel: string;
  created: string;
  saved: string;
  deleted: string;
  couldNotSave: string;
  couldNotDelete: string;
  signInFirst: string;
  deleteConfirm: string;
  noTips: string;
  noTipsDescription: string;
  noMatches: string;
  noMatchesDescription: string;
  loading: string;
  loadFailed: string;
};

export const tips: { en: TipsStrings; cs: TipsStrings } = {
  en: {
    title: "IG TIPS",
    description:
      "Tips saved from Instagram Reels and from research, grouped by topic. Each card says what the tip is and how to use it; Details keeps the notes and sources.",
    addTip: "Add tip",
    searchPlaceholder: "Search tips…",
    groupFilter: "Filter by topic",
    allGroups: "All topics",
    groupLabel: {
      content: "Content ideas",
      formats: "Formats & editing",
      reach: "Platforms & reach",
      growth: "Growth & retention",
      monetization: "Pricing & monetization",
      research: "Research & testing",
      design: "Design & web",
      ai: "AI: cost, quality & safety",
      operations: "Operations & career",
      ungrouped: "Ungrouped",
    },
    count: (n) => `${n} tip${n === 1 ? "" : "s"}`,
    resultCount: (visible, total) => `${visible} of ${total} tips`,
    clearFilters: "Clear filters",
    sourceInstagram: (n) => (n === 1 ? "From an Instagram Reel" : `From ${n} Instagram Reels`),
    sourceWeb: (host) => `From ${host}`,
    forProjects: (names) => `For ${names}`,
    noSummary: "No description yet. Edit the tip to say what it is and how to use it.",
    details: "Details",
    hideDetails: "Hide details",
    openOriginal: "Open original",
    opensInNewTab: "(opens in a new tab)",
    edit: "Edit",
    delete: "Delete",
    notes: "Research notes",
    whyUseful: "Why it is useful",
    usefulness: (n) => `usefulness ${n}/5`,
    projectsThatBenefit: "Projects that benefit",
    sources: "Sources",
    newTitle: "New tip",
    editTitle: "Edit tip",
    titleLabel: "Title",
    urlLabel: "Original URL",
    groupField: "Topic",
    noGroup: "No topic",
    summaryLabel: "What the tip says and how to use it",
    summaryHint: "Two to four plain sentences. This is the text the card shows.",
    notesLabel: "Research notes",
    notesHint: "Longer notes, figures and caveats. They appear under Details.",
    titleRequired: "Give the tip a title.",
    urlRequired: "Add the URL the tip came from.",
    urlInvalid: "Enter a valid URL (https://…).",
    duplicate: "This tip is already saved with the same title and URL.",
    save: "Save",
    create: "Add tip",
    saving: "Saving…",
    cancel: "Cancel",
    created: "Tip added.",
    saved: "Tip saved.",
    deleted: "Tip deleted.",
    couldNotSave: "Could not save the tip. Please try again.",
    couldNotDelete: "Could not delete the tip. Please try again.",
    signInFirst: "Sign in first.",
    deleteConfirm: "Delete this tip? Its links to projects are deleted with it.",
    noTips: "No tips yet",
    noTipsDescription: "Save a tip from a Reel or an article: what it says and how to use it.",
    noMatches: "No tips match",
    noMatchesDescription: "Try another word or another topic.",
    loading: "Loading tips…",
    loadFailed: "Could not load the tips. Reload the page to try again.",
  },
  cs: {
    title: "IG TIPS",
    description:
      "Tipy uložené z Instagram Reels a z průzkumu, seskupené podle tématu. Každá karta říká, o čem tip je a jak ho použít; v Podrobnostech zůstávají poznámky a zdroje.",
    addTip: "Přidat tip",
    searchPlaceholder: "Hledat tipy…",
    groupFilter: "Filtrovat podle tématu",
    allGroups: "Všechna témata",
    groupLabel: {
      content: "Nápady na obsah",
      formats: "Formáty a úpravy",
      reach: "Platformy a dosah",
      growth: "Růst a udržení",
      monetization: "Ceny a monetizace",
      research: "Výzkum a testování",
      design: "Design a web",
      ai: "AI: náklady, kvalita a bezpečnost",
      operations: "Provoz a kariéra",
      ungrouped: "Bez skupiny",
    },
    count: (n) => `${n} ${n === 1 ? "tip" : n >= 2 && n <= 4 ? "tipy" : "tipů"}`,
    resultCount: (visible, total) => `${visible} z ${total} ${total === 1 ? "tipu" : "tipů"}`,
    clearFilters: "Zrušit filtry",
    sourceInstagram: (n) => (n === 1 ? "Z Reelu na Instagramu" : `Z ${n} Reelů na Instagramu`),
    sourceWeb: (host) => `Z ${host}`,
    forProjects: (names) => `Pro ${names}`,
    noSummary: "Zatím bez popisu. Upravte tip a napište, o čem je a jak ho použít.",
    details: "Podrobnosti",
    hideDetails: "Skrýt podrobnosti",
    openOriginal: "Otevřít originál",
    opensInNewTab: "(otevře se na nové kartě)",
    edit: "Upravit",
    delete: "Smazat",
    notes: "Poznámky z průzkumu",
    whyUseful: "Proč se hodí",
    usefulness: (n) => `užitečnost ${n}/5`,
    projectsThatBenefit: "Projekty, kterým pomůže",
    sources: "Zdroje",
    newTitle: "Nový tip",
    editTitle: "Upravit tip",
    titleLabel: "Název",
    urlLabel: "Původní URL",
    groupField: "Téma",
    noGroup: "Bez tématu",
    summaryLabel: "O čem tip je a jak ho použít",
    summaryHint: "Dvě až čtyři jednoduché věty. Právě tento text karta zobrazí.",
    notesLabel: "Poznámky z průzkumu",
    notesHint: "Delší poznámky, čísla a výhrady. Zobrazí se v Podrobnostech.",
    titleRequired: "Pojmenujte tip.",
    urlRequired: "Doplňte URL, odkud tip pochází.",
    urlInvalid: "Zadejte platnou URL (https://…).",
    duplicate: "Tento tip už je uložený se stejným názvem i URL.",
    save: "Uložit",
    create: "Přidat tip",
    saving: "Ukládám…",
    cancel: "Zrušit",
    created: "Tip přidán.",
    saved: "Tip uložen.",
    deleted: "Tip smazán.",
    couldNotSave: "Tip se nepodařilo uložit. Zkuste to znovu.",
    couldNotDelete: "Tip se nepodařilo smazat. Zkuste to znovu.",
    signInFirst: "Nejprve se přihlaste.",
    deleteConfirm: "Smazat tento tip? Smažou se s ním i jeho vazby na projekty.",
    noTips: "Zatím žádné tipy",
    noTipsDescription: "Uložte tip z Reelu nebo článku: o čem je a jak ho použít.",
    noMatches: "Žádný tip neodpovídá",
    noMatchesDescription: "Zkuste jiné slovo nebo jiné téma.",
    loading: "Načítám tipy…",
    loadFailed: "Tipy se nepodařilo načíst. Zkuste stránku načíst znovu.",
  },
};
