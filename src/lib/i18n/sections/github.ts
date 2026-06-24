type GithubStrings = {
  title: string;
  subtitle: string;
  // Not-connected state
  connectTitle: string;
  connectBody: string;
  connect: string;
  reconnect: string;
  // List
  search: string;
  empty: string;
  emptyHint: string;
  loadErr: string;
  refresh: string;
  // Repo visibility filter (saved allow-list)
  filter: string;
  filterTitle: string;
  filterDesc: string;
  filterSearch: string;
  selectAll: string;
  showAll: string;
  save: string;
  saving: string;
  filterSaved: string;
  filterErr: string;
  pickAtLeastOne: string;
  filterHidesAll: string;
  showingCount: (shown: number, total: number) => string;
  updatedPrefix: string;
  never: string;
  privateLabel: string;
  publicLabel: string;
  fork: string;
  archived: string;
  open: string;
  disconnect: string;
  disconnectConfirm: string;
  disconnectOk: string;
  disconnectErr: string;
  // Write-file dialog
  writeFile: string;
  writeTitle: string;
  writeHint: string;
  done: string;
  // Publish-to-repo (from a BlockNote note)
  publish: string;
  publishNote: string;
  repository: string;
  connectFirst: string;
  loadingRepos: string;
  pathLabel: string;
  pathPlaceholder: string;
  branchLabel: string;
  branchPlaceholder: string;
  messageLabel: string;
  messagePlaceholder: string;
  contentLabel: string;
  contentPlaceholder: string;
  commit: string;
  committing: string;
  committedNew: string;
  committedUpdate: string;
  viewCommit: string;
  needPath: string;
  needContent: string;
  cancel: string;
  networkErr: string;
  // Per-repo quick notes (grid cards)
  notesEmpty: string;
  notePlaceholder: string;
  addNote: string;
  deleteNote: string;
  deleteNoteConfirm: string;
  autosaving: string;
  saved: string;
  saveNotes: string;
  savingNotes: string;
  notesNothing: string;
  notesCommitMessage: string;
  notesTargetHint: (path: string) => string;
  notesSavedFile: (path: string) => string;
  notesPushErr: string;
  saveNotesHint: string;
  writeFileHint: string;
  // Per-repo custom link
  linkAdd: string;
  linkEdit: string;
  linkPlaceholder: string;
  linkRemove: string;
  linkInvalid: string;
  linkOpen: string;
  noteSaveErr: string;
  noteDeleted: string;
  noteDeleteErr: string;
  linkSavedToast: string;
  linkRemovedToast: string;
  linkErr: string;
};

export const github: { en: GithubStrings; cs: GithubStrings } = {
  en: {
    title: "Repositories",
    subtitle: "Your active GitHub repositories.",
    connectTitle: "Connect GitHub",
    connectBody:
      "Link your GitHub account to see your active repos and push markdown files straight from the dashboard.",
    connect: "Connect GitHub",
    reconnect: "Reconnect GitHub",
    search: "Filter repos…",
    empty: "No repositories found.",
    emptyHint: "Nothing matches that filter.",
    loadErr: "Could not load repositories.",
    refresh: "Refresh",
    filter: "Choose repos",
    filterTitle: "Choose repositories to show",
    filterDesc:
      "Only the repos you select stay on your dashboard. New repos won't appear until you add them here.",
    filterSearch: "Search repositories…",
    selectAll: "Select all",
    showAll: "Show all",
    save: "Save",
    saving: "Saving…",
    filterSaved: "Repository filter saved.",
    filterErr: "Could not save the filter.",
    pickAtLeastOne: "Select at least one repository, or choose Show all.",
    filterHidesAll: "Your filter hides every repository.",
    showingCount: (shown, total) => `Showing ${shown} of ${total}`,
    updatedPrefix: "Updated",
    never: "never",
    privateLabel: "Private",
    publicLabel: "Public",
    fork: "Fork",
    archived: "Archived",
    open: "Open on GitHub",
    disconnect: "Disconnect GitHub",
    disconnectConfirm: "Disconnect GitHub? You can reconnect any time.",
    disconnectOk: "GitHub disconnected.",
    disconnectErr: "Could not disconnect GitHub.",
    writeFile: "Write file",
    writeTitle: "Write a file to",
    writeHint: "Creates a commit on the chosen branch (defaults to the repo default).",
    done: "Done",
    publish: "Publish to repo",
    publishNote: "Publish note to repo",
    repository: "Repository",
    connectFirst: "Connect GitHub from the Repositories tab first.",
    loadingRepos: "Loading repositories…",
    pathLabel: "File path",
    pathPlaceholder: "notes/2026-06-22.md",
    branchLabel: "Branch (optional)",
    branchPlaceholder: "default branch",
    messageLabel: "Commit message",
    messagePlaceholder: "Add note from dashboard",
    contentLabel: "Markdown",
    contentPlaceholder: "# Hello\n\nWritten from my dashboard.",
    commit: "Commit",
    committing: "Committing…",
    committedNew: "File created.",
    committedUpdate: "File updated.",
    viewCommit: "View commit",
    needPath: "Enter a valid file path.",
    needContent: "Content can't be empty.",
    cancel: "Cancel",
    networkErr: "Network error.",
    notesEmpty: "No notes yet — add one with New note.",
    notePlaceholder: "Write a quick note…",
    addNote: "New note",
    deleteNote: "Delete note",
    deleteNoteConfirm: "Delete this note?",
    autosaving: "Saving…",
    saved: "Saved",
    saveNotes: "Save to GitHub",
    savingNotes: "Saving…",
    notesNothing: "Write a note before saving.",
    notesCommitMessage: "Update dashboard notes",
    notesTargetHint: (path) => `Saves to ${path}`,
    notesSavedFile: (path) => `Saved to ${path} on GitHub.`,
    notesPushErr: "Could not save notes to GitHub.",
    saveNotesHint:
      "Pushes this card's notes to dashboard-notes.md in the repo (creates or updates that one file).",
    writeFileHint:
      "Commit any file — you choose the path, branch, commit message and content.",
    linkAdd: "Add link",
    linkEdit: "Edit link",
    linkPlaceholder: "https://your-site.com",
    linkRemove: "Remove",
    linkInvalid: "Enter a valid URL.",
    linkOpen: "Open link",
    noteSaveErr: "Couldn't save your note — check your connection.",
    noteDeleted: "Note deleted.",
    noteDeleteErr: "Couldn't delete the note. Please try again.",
    linkSavedToast: "Link saved.",
    linkRemovedToast: "Link removed.",
    linkErr: "Couldn't save the link. Please try again.",
  },
  cs: {
    title: "Repozitáře",
    subtitle: "Tvoje aktivní GitHub repozitáře.",
    connectTitle: "Připojit GitHub",
    connectBody:
      "Propoj svůj GitHub účet a uvidíš aktivní repozitáře a budeš moci posílat markdown soubory přímo z dashboardu.",
    connect: "Připojit GitHub",
    reconnect: "Znovu připojit GitHub",
    search: "Filtrovat repozitáře…",
    empty: "Žádné repozitáře.",
    emptyHint: "Filtru nic neodpovídá.",
    loadErr: "Nepodařilo se načíst repozitáře.",
    refresh: "Obnovit",
    filter: "Vybrat repozitáře",
    filterTitle: "Vyber repozitáře k zobrazení",
    filterDesc:
      "Na dashboardu zůstanou jen vybrané repozitáře. Nové se zobrazí, až je sem přidáš.",
    filterSearch: "Hledat repozitáře…",
    selectAll: "Vybrat vše",
    showAll: "Zobrazit vše",
    save: "Uložit",
    saving: "Ukládám…",
    filterSaved: "Filtr repozitářů uložen.",
    filterErr: "Nepodařilo se uložit filtr.",
    pickAtLeastOne: "Vyber aspoň jeden repozitář, nebo zvol Zobrazit vše.",
    filterHidesAll: "Tvůj filtr skrývá všechny repozitáře.",
    showingCount: (shown, total) => `Zobrazeno ${shown} z ${total}`,
    updatedPrefix: "Upraveno",
    never: "nikdy",
    privateLabel: "Soukromý",
    publicLabel: "Veřejný",
    fork: "Fork",
    archived: "Archivovaný",
    open: "Otevřít na GitHubu",
    disconnect: "Odpojit GitHub",
    disconnectConfirm: "Odpojit GitHub? Můžeš ho kdykoli připojit znovu.",
    disconnectOk: "GitHub odpojen.",
    disconnectErr: "Nepodařilo se odpojit GitHub.",
    writeFile: "Zapsat soubor",
    writeTitle: "Zapsat soubor do",
    writeHint: "Vytvoří commit ve zvolené větvi (výchozí je hlavní větev repozitáře).",
    done: "Hotovo",
    publish: "Publikovat do repo",
    publishNote: "Publikovat poznámku do repo",
    repository: "Repozitář",
    connectFirst: "Nejprve připoj GitHub v sekci Repozitáře.",
    loadingRepos: "Načítám repozitáře…",
    pathLabel: "Cesta k souboru",
    pathPlaceholder: "poznamky/2026-06-22.md",
    branchLabel: "Větev (volitelné)",
    branchPlaceholder: "výchozí větev",
    messageLabel: "Commit zpráva",
    messagePlaceholder: "Přidat poznámku z dashboardu",
    contentLabel: "Markdown",
    contentPlaceholder: "# Ahoj\n\nNapsáno z dashboardu.",
    commit: "Commitnout",
    committing: "Commituji…",
    committedNew: "Soubor vytvořen.",
    committedUpdate: "Soubor aktualizován.",
    viewCommit: "Zobrazit commit",
    needPath: "Zadej platnou cestu k souboru.",
    needContent: "Obsah nemůže být prázdný.",
    cancel: "Zrušit",
    networkErr: "Chyba sítě.",
    notesEmpty: "Zatím žádné poznámky — přidej přes Nová poznámka.",
    notePlaceholder: "Napiš rychlou poznámku…",
    addNote: "Nová poznámka",
    deleteNote: "Smazat poznámku",
    deleteNoteConfirm: "Smazat tuto poznámku?",
    autosaving: "Ukládání…",
    saved: "Uloženo",
    saveNotes: "Uložit na GitHub",
    savingNotes: "Ukládání…",
    notesNothing: "Před uložením napiš poznámku.",
    notesCommitMessage: "Aktualizace poznámek z dashboardu",
    notesTargetHint: (path) => `Uloží se do ${path}`,
    notesSavedFile: (path) => `Uloženo do ${path} na GitHubu.`,
    notesPushErr: "Poznámky se nepodařilo uložit na GitHub.",
    saveNotesHint:
      "Uloží poznámky z této karty do souboru dashboard-notes.md v repozitáři (vytvoří nebo aktualizuje právě tento soubor).",
    writeFileHint:
      "Zapíše libovolný soubor — sám zvolíš cestu, větev, commit zprávu i obsah.",
    linkAdd: "Přidat odkaz",
    linkEdit: "Upravit odkaz",
    linkPlaceholder: "https://tvuj-web.cz",
    linkRemove: "Odebrat",
    linkInvalid: "Zadej platnou URL.",
    linkOpen: "Otevřít odkaz",
    noteSaveErr: "Poznámku se nepodařilo uložit — zkontroluj připojení.",
    noteDeleted: "Poznámka smazána.",
    noteDeleteErr: "Poznámku se nepodařilo smazat. Zkuste to znovu.",
    linkSavedToast: "Odkaz uložen.",
    linkRemovedToast: "Odkaz odebrán.",
    linkErr: "Odkaz se nepodařilo uložit. Zkuste to znovu.",
  },
};
