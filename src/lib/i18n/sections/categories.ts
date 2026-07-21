type CategoriesStrings = {
  placeholder: string;
  none: string;
  manage: string;
  manageTitle: string;
  manageDesc: string;
  newPlaceholder: string;
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
      "Create categories to organize your subscriptions and costs. They appear in the category selector.",
    newPlaceholder: "New category name",
    create: "Add",
    empty: "No categories yet.",
    deleteAria: "Delete category",
    exists: "That category already exists.",
    saveErr: "Could not save the category.",
  },
  cs: {
    placeholder: "Vyber kategorii",
    none: "Bez kategorie",
    manage: "Spravovat kategorie",
    manageTitle: "Kategorie",
    manageDesc:
      "Vytvoř kategorie pro organizaci předplatných a nákladů. Objeví se ve výběru kategorie.",
    newPlaceholder: "Název nové kategorie",
    create: "Přidat",
    empty: "Zatím žádné kategorie.",
    deleteAria: "Smazat kategorii",
    exists: "Tahle kategorie už existuje.",
    saveErr: "Kategorii se nepodařilo uložit.",
  },
};
