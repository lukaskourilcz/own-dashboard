type GithubStrings = {
  title: string;
  subtitle: string;
  // Not-connected state
  connectTitle: string;
  connectBody: string;
  connect: string;
  connectErr: string;
  reconnect: string;
  // List
  search: string;
  empty: string;
  emptyHint: string;
  loadErr: string;
  cachedReadFailed: string;
  repositoryUnavailable: string;
  recentPageLimit: (count: number) => string;
  archivedReadOnly: string;
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
  filterLocalOnly: string;
  filterServerOnly: string;
  filterUnavailable: string;
  filterUnlisted: (count: number) => string;
  filterLimit: string;
  filterChanged: string;
  filterReload: string;
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
  disconnectLocalOnly: string;
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
  alreadySaved: string;
  fileChanged: string;
  commitUnconfirmed: string;
  viewCommit: string;
  needPath: string;
  needContent: string;
  cancel: string;
  networkErr: string;
  // Per-repo quick notes (grid cards)
  notesEmpty: string;
  notePlaceholder: string;
  addNote: string;
  editNote: string;
  emptyNote: string;
  doneEditing: string;
  deleteNote: string;
  deleteNoteConfirm: string;
  saved: string;
  saveNotes: string;
  savingNotes: string;
  notesNothing: string;
  notesCommitMessage: string;
  notesSavedFile: (path: string) => string;
  notesSavedCleared: (path: string) => string;
  notesPushErr: string;
  saveNotesHint: string;
  writeFileHint: string;
  // Per-repo custom link
  linkAdd: string;
  linkEdit: string;
  linkPlaceholder: string;
  linkRemove: string;
  linkInvalid: string;
  noteSaveErr: string;
  noteDeleted: string;
  noteDeleteErr: string;
  linkSavedToast: string;
  linkRemovedToast: string;
  linkErr: string;
  linkLabel: string;
  linkChanged: string;
  linkReviewCurrent: string;
  // "Check NEEDED" — combined to-do built from every repo's NEEDED.md
  needed: {
    button: string;
    title: string;
    subtitle: string;
    scanning: string;
    allClear: string;
    allClearDesc: string;
    unavailable: (repos: string) => string;
    reconnect: string;
    checkOff: string;
    itemsCount: (n: number) => string;
    removedFrom: (repo: string, path: string) => string;
    updateErr: string;
    commitMessage: (text: string) => string;
    createTodos: string;
    createTodosHint: string;
    todosCreated: (count: number, repos: number) => string;
    todosNoneNew: string;
    todosErr: string;
  };
};

export const github: { en: GithubStrings; cs: GithubStrings } = {
  en: {
    archivedReadOnly: "This repository is archived and read-only on GitHub.",
    cachedReadFailed: "Could not refresh GitHub data. Previously loaded values may be out of date.",
    repositoryUnavailable: "This repository is not visible to the connected GitHub account.",
    recentPageLimit: count => `Showing the ${count} most recently pushed repositories. Other saved selections are kept; open a project to load its repository directly.`,
    filterChanged: "Repository selection changed elsewhere. Your open selection has been kept; load the current selection before saving again.",
    filterReload: "Load current selection",
    filterLocalOnly: "Filter saved on this device. Cross-device sync was not confirmed.",
    filterServerOnly: "Filter synchronized. Its offline copy could not be confirmed.",
    filterUnavailable: "Repository selection is unavailable. Automatic project sync is paused; existing projects remain available.",
    filterUnlisted: count => `${count} saved selections are outside this result page and will be kept.`,
    filterLimit: "Choose up to 500 repositories.",
    linkLabel: "Repository website",
    linkChanged: "The saved link changed. Review its current value before saving your retained draft.",
    linkReviewCurrent: "Review current value",
    title: "Repositories",
    subtitle: "Your active GitHub repositories.",
    connectTitle: "Connect GitHub",
    connectBody:
      "Link your GitHub account to manage a project's repository and publish markdown files from its workspace.",
    connect: "Connect GitHub",
    connectErr: "Could not start the GitHub connection. Try again.",
    reconnect: "Reconnect GitHub",
    search: "Filter repos…",
    empty: "No repositories found.",
    emptyHint: "Nothing matches that filter.",
    loadErr: "Could not load repositories.",
    refresh: "Refresh",
    filter: "Choose repos",
    filterTitle: "Repositories for project sync",
    filterDesc:
      "Choose repositories for automatic project sync. Existing project records stay available. Show all also includes newly found repositories.",
    filterSearch: "Search repositories…",
    selectAll: "Select all",
    showAll: "Show all",
    save: "Save",
    saving: "Saving…",
    filterSaved: "Repository filter saved.",
    filterErr: "Could not confirm the filter. Your selection is still open.",
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
    disconnectLocalOnly: "Disconnected locally. GitHub grant revocation could not be confirmed; review it in GitHub settings.",
    writeFile: "Write file",
    writeTitle: "Write a file to",
    writeHint: "Creates a commit on the chosen branch (defaults to the repo default).",
    done: "Done",
    publish: "Publish to repo",
    publishNote: "Publish note to repo",
    repository: "Repository",
    connectFirst: "Connect GitHub from a project's Repository tab first.",
    loadingRepos: "Loading repositories…",
    pathLabel: "File path",
    pathPlaceholder: "notes/2026-06-22.md",
    branchLabel: "Branch (optional)",
    branchPlaceholder: "default branch",
    messageLabel: "Commit message",
    messagePlaceholder: "Add note from project workspace",
    contentLabel: "Markdown",
    contentPlaceholder: "# Hello\n\nWritten from my project workspace.",
    commit: "Commit",
    committing: "Committing…",
    committedNew: "File created.",
    alreadySaved: "The file already contains these contents.",
    fileChanged: "The file changed on GitHub. Reload it before editing.",
    commitUnconfirmed: "The save could not be confirmed. Check the repository before trying again.",
    committedUpdate: "File updated.",
    viewCommit: "View commit",
    needPath: "Enter a valid file path.",
    needContent: "Content can't be empty.",
    cancel: "Cancel",
    networkErr: "Network error.",
    notesEmpty: "No notes yet — add one with New note.",
    notePlaceholder: "Write a quick note…",
    addNote: "New note",
    editNote: "Edit note",
    emptyNote: "Empty note — click edit to write something.",
    doneEditing: "Done",
    deleteNote: "Delete note",
    deleteNoteConfirm: "Delete this note?",
    saved: "Saved",
    saveNotes: "Save to GitHub",
    savingNotes: "Saving…",
    notesNothing: "Write a note before saving.",
    notesCommitMessage: "Update project notes",
    notesSavedFile: (path) => `Saved to ${path} on GitHub. Notes remain in this dashboard.`,
    notesSavedCleared: (path) =>
      `${path} created on GitHub — notes cleared from the project workspace.`,
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
    noteSaveErr: "Couldn't save your note — check your connection.",
    noteDeleted: "Note deleted.",
    noteDeleteErr: "Couldn't delete the note. Please try again.",
    linkSavedToast: "Link saved.",
    linkRemovedToast: "Link removed.",
    linkErr: "Couldn't save the link. Please try again.",
    needed: {
      button: "Check NEEDED",
      title: "NEEDED — combined to-do",
      subtitle:
        "Open items pulled from every repo's NEEDED.md. Checking one commits its removal from that file.",
      scanning: "Scanning repositories…",
      allClear: "All clear",
      allClearDesc: "No open NEEDED items across your repositories.",
      unavailable: (repos) => `Lists unavailable: ${repos}. Only readable lists can be imported.`,
      reconnect: "Reconnect GitHub to sync NEEDED files.",
      checkOff: "Check off & remove from NEEDED.md",
      itemsCount: (n) => (n === 1 ? "1 item" : `${n} items`),
      removedFrom: (repo, path) => `Removed from ${repo}/${path}.`,
      updateErr: "Could not update NEEDED.md.",
      commitMessage: (text) => `chore: check off NEEDED item — ${text}`,
      createTodos: "Add to Tasks",
      createTodosHint:
        "Create a task in Tasks for every open item, grouped by repository.",
      todosCreated: (count, repos) =>
        `Added ${count} task${count === 1 ? "" : "s"} across ${repos} repo${repos === 1 ? "" : "s"} to Tasks.`,
      todosNoneNew: "Tasks are already up to date — nothing new to add.",
      todosErr: "Couldn't create the tasks. Please try again.",
    },
  },
  cs: {
    archivedReadOnly: "Tento repozitář je na GitHubu archivovaný a je pouze pro čtení.",
    cachedReadFailed: "Data z GitHubu se nepodařilo obnovit. Dříve načtené hodnoty mohou být zastaralé.",
    repositoryUnavailable: "Tento repozitář není dostupný připojenému účtu GitHub.",
    recentPageLimit: count => `Zobrazuje se ${count} naposledy aktualizovaných repozitářů. Ostatní uložené výběry zůstávají zachovány; repozitář načtete přímo otevřením projektu.`,
    filterChanged: "Výběr repozitářů se změnil jinde. Otevřený výběr zůstává zachován; před dalším uložením načtěte aktuální výběr.",
    filterReload: "Načíst aktuální výběr",
    filterLocalOnly: "Filtr je uložen v tomto zařízení. Synchronizaci mezi zařízeními se nepodařilo potvrdit.",
    filterServerOnly: "Filtr je synchronizován. Kopii pro práci offline se nepodařilo potvrdit.",
    filterUnavailable: "Výběr repozitářů není dostupný. Automatická synchronizace projektů je pozastavena; stávající projekty zůstávají dostupné.",
    filterUnlisted: count => `${count} uložených výběrů není na této stránce výsledků a zůstane zachováno.`,
    filterLimit: "Vyberte nejvýše 500 repozitářů.",
    linkLabel: "Web repozitáře",
    linkChanged: "Uložený odkaz se změnil. Před uložením zachovaného návrhu zkontrolujte jeho aktuální hodnotu.",
    linkReviewCurrent: "Zkontrolovat aktuální hodnotu",
    title: "Repozitáře",
    subtitle: "Tvoje aktivní GitHub repozitáře.",
    connectTitle: "Připojit GitHub",
    connectBody:
      "Propoj GitHub účet a spravuj repozitář projektu i publikování markdown souborů přímo z jeho pracovního prostoru.",
    connect: "Připojit GitHub",
    connectErr: "Připojení ke GitHubu se nepodařilo zahájit. Zkuste to znovu.",
    reconnect: "Znovu připojit GitHub",
    search: "Filtrovat repozitáře…",
    empty: "Žádné repozitáře.",
    emptyHint: "Filtru nic neodpovídá.",
    loadErr: "Nepodařilo se načíst repozitáře.",
    refresh: "Obnovit",
    filter: "Vybrat repozitáře",
    filterTitle: "Repozitáře pro synchronizaci projektů",
    filterDesc:
      "Vyberte repozitáře pro automatickou synchronizaci projektů. Stávající záznamy projektů zůstávají dostupné. Zobrazit vše zahrne i nově nalezené repozitáře.",
    filterSearch: "Hledat repozitáře…",
    selectAll: "Vybrat vše",
    showAll: "Zobrazit vše",
    save: "Uložit",
    saving: "Ukládám…",
    filterSaved: "Filtr repozitářů uložen.",
    filterErr: "Uložení filtru se nepodařilo potvrdit. Výběr zůstává otevřený.",
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
    disconnectLocalOnly: "Místní připojení bylo odebráno. Zrušení oprávnění na GitHubu se nepodařilo potvrdit; zkontrolujte ho v nastavení GitHubu.",
    writeFile: "Zapsat soubor",
    writeTitle: "Zapsat soubor do",
    writeHint: "Vytvoří commit ve zvolené větvi (výchozí je hlavní větev repozitáře).",
    done: "Hotovo",
    publish: "Publikovat do repo",
    publishNote: "Publikovat poznámku do repo",
    repository: "Repozitář",
    connectFirst: "Nejprve připoj GitHub na kartě Repozitář některého projektu.",
    loadingRepos: "Načítám repozitáře…",
    pathLabel: "Cesta k souboru",
    pathPlaceholder: "poznamky/2026-06-22.md",
    branchLabel: "Větev (volitelné)",
    branchPlaceholder: "výchozí větev",
    messageLabel: "Commit zpráva",
    messagePlaceholder: "Přidat poznámku z prostoru projektu",
    contentLabel: "Markdown",
    contentPlaceholder: "# Ahoj\n\nNapsáno z pracovního prostoru projektu.",
    commit: "Commitnout",
    committing: "Commituji…",
    committedNew: "Soubor vytvořen.",
    alreadySaved: "Soubor už obsahuje tento obsah.",
    fileChanged: "Soubor se na GitHubu změnil. Před úpravou ho načtěte znovu.",
    commitUnconfirmed: "Uložení se nepodařilo potvrdit. Před dalším pokusem zkontrolujte repozitář.",
    committedUpdate: "Soubor aktualizován.",
    viewCommit: "Zobrazit commit",
    needPath: "Zadej platnou cestu k souboru.",
    needContent: "Obsah nemůže být prázdný.",
    cancel: "Zrušit",
    networkErr: "Chyba sítě.",
    notesEmpty: "Zatím žádné poznámky — přidej přes Nová poznámka.",
    notePlaceholder: "Napiš rychlou poznámku…",
    addNote: "Nová poznámka",
    editNote: "Upravit poznámku",
    emptyNote: "Prázdná poznámka — uprav ji kliknutím na tužku.",
    doneEditing: "Hotovo",
    deleteNote: "Smazat poznámku",
    deleteNoteConfirm: "Smazat tuto poznámku?",
    saved: "Uloženo",
    saveNotes: "Uložit na GitHub",
    savingNotes: "Ukládání…",
    notesNothing: "Před uložením napiš poznámku.",
    notesCommitMessage: "Aktualizace poznámek projektu",
    notesSavedFile: (path) => `Uloženo do ${path} na GitHubu. Poznámky zůstávají v dashboardu.`,
    notesSavedCleared: (path) =>
      `${path} vytvořen na GitHubu — poznámky z prostoru projektu smazány.`,
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
    noteSaveErr: "Poznámku se nepodařilo uložit — zkontroluj připojení.",
    noteDeleted: "Poznámka smazána.",
    noteDeleteErr: "Poznámku se nepodařilo smazat. Zkuste to znovu.",
    linkSavedToast: "Odkaz uložen.",
    linkRemovedToast: "Odkaz odebrán.",
    linkErr: "Odkaz se nepodařilo uložit. Zkuste to znovu.",
    needed: {
      button: "Zkontrolovat NEEDED",
      title: "NEEDED — společný seznam úkolů",
      subtitle:
        "Otevřené položky ze souborů NEEDED.md všech repozitářů. Odškrtnutí commitne jejich odebrání z daného souboru.",
      scanning: "Prohledávám repozitáře…",
      allClear: "Hotovo",
      allClearDesc: "Žádné otevřené NEEDED položky v repozitářích.",
      unavailable: (repos) => `Nedostupné seznamy: ${repos}. Importovat lze jen načtené seznamy.`,
      reconnect: "Připoj znovu GitHub pro synchronizaci NEEDED souborů.",
      checkOff: "Odškrtnout a odebrat z NEEDED.md",
      itemsCount: (n) => {
        if (n === 1) return "1 položka";
        if (n >= 2 && n <= 4) return `${n} položky`;
        return `${n} položek`;
      },
      removedFrom: (repo, path) => `Odebráno z ${repo}/${path}.`,
      updateErr: "Nepodařilo se aktualizovat NEEDED.md.",
      commitMessage: (text) => `chore: odškrtnutí NEEDED položky — ${text}`,
      createTodos: "Přidat do úkolů",
      createTodosHint:
        "Vytvoří úkol v sekci Úkoly pro každou otevřenou položku, seskupené podle repozitáře.",
      todosCreated: (count, repos) =>
        `Přidáno ${count} úkol${count === 1 ? "" : count >= 2 && count <= 4 ? "y" : "ů"} z ${repos} repozitář${repos === 1 ? "e" : "ů"} do Úkolů.`,
      todosNoneNew: "Úkoly jsou aktuální — není co přidat.",
      todosErr: "Úkoly se nepodařilo vytvořit. Zkuste to znovu.",
    },
  },
};
