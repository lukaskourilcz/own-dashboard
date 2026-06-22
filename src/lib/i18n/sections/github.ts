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
  },
};
