type CategoriesStrings = {
  placeholder: string;
  none: string;
  manage: string;
  manageTitle: string;
  manageDesc: string;
  newPlaceholder: string;
  newName: string;
  loadErr: string;
  readOnly: string;
  changed: string;
  contextChanged: string;
  removeTitle: string;
  removeDescription: (name: string) => string;
  remove: string;
  create: string;
  empty: string;
  deleteAria: string;
  exists: string;
  saveErr: string;
};

export const categories: { en: CategoriesStrings; cs: CategoriesStrings } = {
  en: {
    placeholder: "Select category",
    none: "No category",
    manage: "Manage categories",
    manageTitle: "Categories",
    manageDesc:
      "Choices shared by your subscriptions and transactions.",
    newPlaceholder: "For example, Software",
    newName: "New category name",
    loadErr: "Could not load categories. Existing labels are still available.",
    readOnly: "Sign in to manage your categories.",
    changed: "This category changed or was removed. Reload the list before trying again.",
    contextChanged: "The item changed. Choose the category again.",
    removeTitle: "Remove category?",
    removeDescription: (name) => `Remove “${name}” from the picker? Existing subscriptions and transactions keep their labels.`,
    remove: "Remove",
    create: "Add",
    empty: "No categories yet.",
    deleteAria: "Remove category",
    exists: "That category already exists.",
    saveErr: "Could not save the category.",
  },
  cs: {
    placeholder: "Vyber kategorii",
    none: "Bez kategorie",
    manage: "Spravovat kategorie",
    manageTitle: "Kategorie",
    manageDesc:
      "Společná nabídka pro předplatná a transakce.",
    newPlaceholder: "Například Software",
    newName: "Název nové kategorie",
    loadErr: "Kategorie se nepodařilo načíst. Dosavadní štítky jsou stále k dispozici.",
    readOnly: "Pro správu kategorií se přihlas.",
    changed: "Kategorie se změnila nebo už byla odebrána. Před dalším pokusem načti seznam znovu.",
    contextChanged: "Položka se změnila. Vyber kategorii znovu.",
    removeTitle: "Odebrat kategorii?",
    removeDescription: (name) => `Odebrat „${name}“ z nabídky? Dosavadní předplatná a transakce si své štítky ponechají.`,
    remove: "Odebrat",
    create: "Přidat",
    empty: "Zatím žádné kategorie.",
    deleteAria: "Odebrat kategorii",
    exists: "Tahle kategorie už existuje.",
    saveErr: "Kategorii se nepodařilo uložit.",
  },
};
