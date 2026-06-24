type ShortcutsStrings = {
  title: string;
  description: string;
  addShortcut: string;
  searchPlaceholder: string;
  // Cell
  copy: string;
  copied: string;
  couldNotCopy: string;
  edit: string;
  delete: string;
  deleteShortcut: string;
  deleteConfirm: string;
  // Dialog / form
  newTitle: string;
  editTitle: string;
  command: string;
  commandPlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  cancel: string;
  create: string;
  save: string;
  saving: string;
  commandRequired: string;
  signInFirst: string;
  couldNotSave: string;
  couldNotDelete: string;
  createdToast: string;
  savedToast: string;
  deletedToast: string;
  // Empty states
  noShortcutsYet: string;
  noShortcutsDescription: string;
  noMatches: string;
  noMatchesDescription: string;
};

export const shortcuts: { en: ShortcutsStrings; cs: ShortcutsStrings } = {
  en: {
    title: "Shortcuts",
    description: "Commands and snippets kept one click away — click to copy.",
    addShortcut: "Add shortcut",
    searchPlaceholder: "Search shortcuts…",
    copy: "Click to copy",
    copied: "Copied to clipboard",
    couldNotCopy: "Could not copy to clipboard.",
    edit: "Edit",
    delete: "Delete",
    deleteShortcut: "Delete shortcut",
    deleteConfirm: "Delete this shortcut? This cannot be undone.",
    newTitle: "Add shortcut",
    editTitle: "Edit shortcut",
    command: "Command",
    commandPlaceholder: "sudo docker compose up -d seaweedfs-s3",
    descriptionLabel: "Description (tooltip)",
    descriptionPlaceholder: "Starts the S3 server.",
    cancel: "Cancel",
    create: "Create",
    save: "Save",
    saving: "Saving…",
    commandRequired: "Command is required.",
    signInFirst: "Sign in first.",
    couldNotSave: "Could not save the shortcut. Please try again.",
    couldNotDelete: "Could not delete the shortcut. Please try again.",
    createdToast: "Shortcut added.",
    savedToast: "Shortcut saved.",
    deletedToast: "Shortcut deleted.",
    noShortcutsYet: "No shortcuts yet",
    noShortcutsDescription: "Add a command you want one click away.",
    noMatches: "No matches",
    noMatchesDescription: "Try a different search.",
  },
  cs: {
    title: "Zkratky",
    description: "Příkazy a útržky po ruce — kliknutím zkopíruješ.",
    addShortcut: "Přidat zkratku",
    searchPlaceholder: "Hledat zkratky…",
    copy: "Kliknutím zkopíruješ",
    copied: "Zkopírováno do schránky",
    couldNotCopy: "Nepodařilo se zkopírovat do schránky.",
    edit: "Upravit",
    delete: "Smazat",
    deleteShortcut: "Smazat zkratku",
    deleteConfirm: "Smazat tuto zkratku? Tuto akci nelze vrátit zpět.",
    newTitle: "Přidat zkratku",
    editTitle: "Upravit zkratku",
    command: "Příkaz",
    commandPlaceholder: "sudo docker compose up -d seaweedfs-s3",
    descriptionLabel: "Popis (tooltip)",
    descriptionPlaceholder: "Spustí S3 server.",
    cancel: "Zrušit",
    create: "Vytvořit",
    save: "Uložit",
    saving: "Ukládání…",
    commandRequired: "Příkaz je povinný.",
    signInFirst: "Nejprve se přihlaste.",
    couldNotSave: "Zkratku se nepodařilo uložit. Zkuste to znovu.",
    couldNotDelete: "Zkratku se nepodařilo smazat. Zkuste to znovu.",
    createdToast: "Zkratka přidána.",
    savedToast: "Zkratka uložena.",
    deletedToast: "Zkratka smazána.",
    noShortcutsYet: "Zatím žádné zkratky",
    noShortcutsDescription: "Přidej příkaz, který chceš mít po ruce.",
    noMatches: "Žádné výsledky",
    noMatchesDescription: "Zkus jiné hledání.",
  },
};
