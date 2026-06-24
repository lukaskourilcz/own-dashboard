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
};

export const costs: { en: CostsStrings; cs: CostsStrings } = {
  en: {
    title: "App costs & scaling",
    description:
      "Tech stack, running costs and scaling for your active repositories.",
    noActiveRepos: "No active repositories",
    noActiveReposDesc:
      "Pick the repos you want to track in the Repositories section — they show up here.",
    openRepositories: "Open Repositories",
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
  },
  cs: {
    title: "Náklady a škálování aplikací",
    description:
      "Tech stack, náklady na provoz a škálování tvých aktivních repozitářů.",
    noActiveRepos: "Žádné aktivní repozitáře",
    noActiveReposDesc:
      "Vyber repozitáře, které chceš sledovat, v sekci Repozitáře — objeví se tady.",
    openRepositories: "Otevřít Repozitáře",
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
  },
};
