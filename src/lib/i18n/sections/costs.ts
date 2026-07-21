type CostsStrings = {
  title: string;
  description: string;
  // Empty / states
  noActiveRepos: string;
  noActiveReposDesc: string;
  openRepositories: string;
  fileMissingTitle: string;
  fileMissingDesc: string;
  copyPrompt: string;
  promptCopied: string;
  couldNotCopy: string;
  loadErr: string;
  retry: string;
  refresh: string;
  viewFile: string;
  openRepo: string;
  // Filter
  filter: string;
  filterTitle: string;
  onlyWithFile: string;
  onlyWithFileHint: string;
  reposLabel: string;
  hasFile: string;
  noFile: string;
  showRepo: string;
  hideRepo: string;
  clearFilters: string;
  done: string;
  noMatch: string;
  noMatchDesc: string;
  // Cost overview (aggregate spend pies)
  overviewTitle: string;
  overviewMonthly: string;
  overviewYearly: string;
  overviewTotal: string;
  overviewProjects: string;
  overviewSubscriptions: string;
  overviewUncategorized: string;
  overviewEmpty: string;
  overviewPerMo: string;
  overviewPerYr: string;
};

export const costs: { en: CostsStrings; cs: CostsStrings } = {
  en: {
    title: "Stack & scaling",
    description:
      "Tech stack and scaling notes for this project's repository.",
    noActiveRepos: "No active repositories",
    noActiveReposDesc:
      "Link a GitHub repository to this project to inspect its stack and scaling notes.",
    openRepositories: "Open project repository",
    fileMissingTitle: "No stack-and-scaling.md yet",
    fileMissingDesc:
      "Add it to the repo root. Copy the prompt and run it in that repo with Claude Code.",
    copyPrompt: "Copy prompt",
    promptCopied: "Prompt copied to clipboard.",
    couldNotCopy: "Could not copy to clipboard.",
    loadErr: "Could not load this file.",
    retry: "Retry",
    refresh: "Refresh",
    viewFile: "View file",
    openRepo: "Open repo",
    filter: "Filter",
    filterTitle: "Filter repositories",
    onlyWithFile: "Only repos with a stack-and-scaling.md file",
    onlyWithFileHint:
      "Hide repositories that don't have the file in their root.",
    reposLabel: "Repositories",
    hasFile: "Has file",
    noFile: "No file",
    showRepo: "Show repository",
    hideRepo: "Hide repository",
    clearFilters: "Clear filters",
    done: "Done",
    noMatch: "No repositories match your filter",
    noMatchDesc: "Adjust or clear the filter to see cost cards.",
    overviewTitle: "Cost overview",
    overviewMonthly: "Monthly",
    overviewYearly: "Yearly",
    overviewTotal: "All costs",
    overviewProjects: "Projects",
    overviewSubscriptions: "Subscriptions",
    overviewUncategorized: "Other",
    overviewEmpty: "Add project costs or subscriptions to see the breakdown.",
    overviewPerMo: "/mo",
    overviewPerYr: "/yr",
  },
  cs: {
    title: "Stack a škálování",
    description:
      "Tech stack a poznámky ke škálování pro repozitář tohoto projektu.",
    noActiveRepos: "Žádné aktivní repozitáře",
    noActiveReposDesc:
      "Propoj s projektem GitHub repozitář a zobraz jeho stack a poznámky ke škálování.",
    openRepositories: "Otevřít repozitář projektu",
    fileMissingTitle: "Zatím žádný stack-and-scaling.md",
    fileMissingDesc:
      "Přidej ho do rootu repa. Zkopíruj prompt a spusť ho v daném repu přes Claude Code.",
    copyPrompt: "Kopírovat prompt",
    promptCopied: "Prompt zkopírován do schránky.",
    couldNotCopy: "Nepodařilo se zkopírovat do schránky.",
    loadErr: "Soubor se nepodařilo načíst.",
    retry: "Zkusit znovu",
    refresh: "Obnovit",
    viewFile: "Zobrazit soubor",
    openRepo: "Otevřít repo",
    filter: "Filtr",
    filterTitle: "Filtrovat repozitáře",
    onlyWithFile: "Jen repozitáře se souborem stack-and-scaling.md",
    onlyWithFileHint: "Skryje repozitáře, které nemají soubor v rootu.",
    reposLabel: "Repozitáře",
    hasFile: "Má soubor",
    noFile: "Bez souboru",
    showRepo: "Zobrazit repozitář",
    hideRepo: "Skrýt repozitář",
    clearFilters: "Zrušit filtry",
    done: "Hotovo",
    noMatch: "Filtru neodpovídá žádný repozitář",
    noMatchDesc: "Uprav nebo zruš filtr, aby se karty zobrazily.",
    overviewTitle: "Přehled nákladů",
    overviewMonthly: "Měsíčně",
    overviewYearly: "Ročně",
    overviewTotal: "Všechny náklady",
    overviewProjects: "Projekty",
    overviewSubscriptions: "Předplatná",
    overviewUncategorized: "Ostatní",
    overviewEmpty: "Přidej náklady projektů nebo předplatná a uvidíš rozpad.",
    overviewPerMo: "/měs",
    overviewPerYr: "/rok",
  },
};
