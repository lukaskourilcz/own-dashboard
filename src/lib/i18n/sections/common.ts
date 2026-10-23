type CommonStrings = {
  unsaved: { title: string; description: string; stay: string; discard: string; save: string; saving: string; failed: string; invalid: string };
  add: string;
  save: string;
  cancel: string;
  delete: string;
  edit: string;
  loading: string;
  redirecting: string;
  none: string;
  optional: string;
  deletePermanentlyConfirm: string;
  signInFirst: string;
};

export const common: { en: CommonStrings; cs: CommonStrings } = {
  en: {
    unsaved: { title: "Save your changes?", description: "This draft has unsaved changes. Save it before leaving, or discard the changes.", stay: "Stay here", discard: "Discard and leave", save: "Save and leave", saving: "Saving…", failed: "Could not save. Your changes are still here. Try again or stay to review them.", invalid: "Stay here and correct the fields before saving." },
    add: "Add",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    loading: "Loading…",
    redirecting: "Redirecting…",
    none: "None",
    optional: "Optional",
    deletePermanentlyConfirm: "This item will be permanently deleted.",
    signInFirst: "Sign in first.",
  },
  cs: {
    unsaved: { title: "Uložit změny?", description: "Návrh obsahuje neuložené změny. Před odchodem je uložte, nebo zahoďte.", stay: "Zůstat zde", discard: "Zahodit a odejít", save: "Uložit a odejít", saving: "Ukládání…", failed: "Uložení se nezdařilo. Změny tu zůstávají. Zkuste to znovu, nebo se vraťte k úpravám.", invalid: "Před uložením se vraťte a opravte pole." },
    add: "Přidat",
    save: "Uložit",
    cancel: "Zrušit",
    delete: "Smazat",
    edit: "Upravit",
    loading: "Načítání…",
    redirecting: "Přesměrování…",
    none: "Žádné",
    optional: "Volitelné",
    deletePermanentlyConfirm: "Tato položka bude nenávratně smazána.",
    signInFirst: "Nejprve se přihlaste.",
  },
};
