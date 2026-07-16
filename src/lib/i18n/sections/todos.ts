type TodosStrings = {
  title: string;
  description: string;
  compactTitle: string;
  openDoneCount: (open: number, done: number) => string;
  allClear: string;
  allClearDescription: string;
  addTask: string;
  addTaskTitle: string;
  whatNeedsDoing: string;
  dueDate: string;
  allTasks: string;
  nothingOnPlate: string;
  nothingOnPlateDescription: string;
  quickAddPlaceholder: string;
  due: (date: string) => string;
  // date-fns format pattern for due dates; the locale object is applied separately.
  dueDateFormat: string;
  fromPartner: (name: string) => string;
  partnerFallback: string;
  otherCategory: string;
  // Personal (hand-added) tasks group heading in the repo-card layout.
  personalGroup: string;
  // NEEDED.md task cards
  refresh: string;
  refreshHint: string;
  refreshing: string;
  refreshDone: (added: number, removed: number) => string;
  refreshNothing: string;
  refreshDisconnected: string;
  refreshNoRepos: string;
  refreshErr: string;
  neededBadge: string;
  openNeeded: string;
  repoTaskCount: (n: number) => string;
  generatedOn: (date: string) => string;
  // "time to finish" chip on a task card; n days (negative = overdue, 0 = today).
  timeLeft: (n: number) => string;
  dueTodayTag: string;
  // Finished-tasks subsection
  finishedTitle: string;
  finishedCount: (n: number) => string;
  finishedShow: string;
  finishedHide: string;
  finishedEmpty: string;
  reopen: string;
  clearFromNeeded: string;
  clearFromNeededHint: string;
  clearFromNeededConfirm: string;
  clearFromNeededDone: (n: number) => string;
  clearFromNeededNone: string;
  clearFromNeededErr: string;
  clearingFromNeeded: string;
  finishedCommitMessage: (n: number) => string;
};

export const todos: { en: TodosStrings; cs: TodosStrings } = {
  en: {
    title: "Tasks",
    description: "What you're working on and what's coming up.",
    compactTitle: "Tasks",
    openDoneCount: (open, done) => `${open} open · ${done} done`,
    allClear: "All clear",
    allClearDescription: "No open tasks. Add one above.",
    addTask: "Add task",
    addTaskTitle: "Add task",
    whatNeedsDoing: "What needs doing?",
    dueDate: "Due date",
    allTasks: "All tasks",
    nothingOnPlate: "Nothing on your plate",
    nothingOnPlateDescription: "Add a task on the left to get started.",
    quickAddPlaceholder: "Add a task…",
    due: (date) => `due ${date}`,
    dueDateFormat: "d MMM",
    fromPartner: (name) => `From ${name}`,
    partnerFallback: "partner",
    otherCategory: "Other",
    personalGroup: "Personal",
    refresh: "Refresh",
    refreshHint:
      "Re-scan every repo's NEEDED.md — add new tasks and drop ones no longer listed.",
    refreshing: "Refreshing…",
    refreshDone: (added, removed) =>
      `Refreshed — ${added} added, ${removed} removed.`,
    refreshNothing: "Already up to date.",
    refreshDisconnected: "Reconnect GitHub to refresh tasks.",
    refreshNoRepos: "Connect GitHub to sync tasks from NEEDED.md.",
    refreshErr: "Couldn't refresh tasks. Please try again.",
    neededBadge: "NEEDED",
    openNeeded: "Open NEEDED.md",
    repoTaskCount: (n) => (n === 1 ? "1 task" : `${n} tasks`),
    generatedOn: (date) => `generated ${date}`,
    timeLeft: (n) =>
      n < 0
        ? `${-n}d overdue`
        : n === 0
          ? "due today"
          : n === 1
            ? "1 day left"
            : `${n} days left`,
    dueTodayTag: "due today",
    finishedTitle: "Finished tasks",
    finishedCount: (n) => (n === 1 ? "1 done" : `${n} done`),
    finishedShow: "Show finished",
    finishedHide: "Hide finished",
    finishedEmpty: "No finished tasks yet.",
    reopen: "Reopen",
    clearFromNeeded: "Delete from NEEDED.md",
    clearFromNeededHint:
      "Commit the removal of finished tasks from their repo's NEEDED.md, then clear them.",
    clearFromNeededConfirm:
      "Remove finished tasks from their NEEDED.md files on GitHub and clear them?",
    clearFromNeededDone: (n) =>
      `Removed ${n} finished task${n === 1 ? "" : "s"} from NEEDED.md.`,
    clearFromNeededNone: "No finished NEEDED tasks to remove.",
    clearFromNeededErr: "Couldn't update NEEDED.md. Please try again.",
    clearingFromNeeded: "Removing…",
    finishedCommitMessage: (n) =>
      `chore: remove ${n} finished task${n === 1 ? "" : "s"} from NEEDED.md`,
  },
  cs: {
    title: "Úkoly",
    description: "Na čem pracuješ a co tě čeká.",
    compactTitle: "Úkoly",
    openDoneCount: (open, done) =>
      `${csCount(open, "otevřený", "otevřené", "otevřených")} · ${csCount(
        done,
        "hotový",
        "hotové",
        "hotových",
      )}`,
    allClear: "Hotovo",
    allClearDescription: "Žádné otevřené úkoly. Přidej nějaký výše.",
    addTask: "Přidat úkol",
    addTaskTitle: "Přidat úkol",
    whatNeedsDoing: "Co je potřeba udělat?",
    dueDate: "Termín",
    allTasks: "Všechny úkoly",
    nothingOnPlate: "Nemáš nic na práci",
    nothingOnPlateDescription: "Přidej úkol vlevo a začni.",
    quickAddPlaceholder: "Přidat úkol…",
    due: (date) => `termín ${date}`,
    dueDateFormat: "d. MMM",
    fromPartner: (name) => `Od: ${name}`,
    partnerFallback: "partnera",
    otherCategory: "Ostatní",
    personalGroup: "Osobní",
    refresh: "Obnovit",
    refreshHint:
      "Znovu projde NEEDED.md všech repozitářů — přidá nové úkoly a odebere ty, které už tam nejsou.",
    refreshing: "Obnovuji…",
    refreshDone: (added, removed) =>
      `Obnoveno — přidáno ${added}, odebráno ${removed}.`,
    refreshNothing: "Vše je aktuální.",
    refreshDisconnected: "Pro obnovení úkolů znovu připoj GitHub.",
    refreshNoRepos: "Připoj GitHub pro synchronizaci úkolů z NEEDED.md.",
    refreshErr: "Úkoly se nepodařilo obnovit. Zkus to znovu.",
    neededBadge: "NEEDED",
    openNeeded: "Otevřít NEEDED.md",
    repoTaskCount: (n) => {
      if (n === 1) return "1 úkol";
      if (n >= 2 && n <= 4) return `${n} úkoly`;
      return `${n} úkolů`;
    },
    generatedOn: (date) => `vygenerováno ${date}`,
    timeLeft: (n) => {
      if (n < 0) return `${-n} d po termínu`;
      if (n === 0) return "termín dnes";
      if (n === 1) return "zbývá 1 den";
      if (n >= 2 && n <= 4) return `zbývají ${n} dny`;
      return `zbývá ${n} dní`;
    },
    dueTodayTag: "termín dnes",
    finishedTitle: "Hotové úkoly",
    finishedCount: (n) => {
      if (n === 1) return "1 hotový";
      if (n >= 2 && n <= 4) return `${n} hotové`;
      return `${n} hotových`;
    },
    finishedShow: "Zobrazit hotové",
    finishedHide: "Skrýt hotové",
    finishedEmpty: "Zatím žádné hotové úkoly.",
    reopen: "Znovu otevřít",
    clearFromNeeded: "Smazat z NEEDED.md",
    clearFromNeededHint:
      "Commitne odebrání hotových úkolů z NEEDED.md daného repozitáře a pak je vyčistí.",
    clearFromNeededConfirm:
      "Odebrat hotové úkoly ze souborů NEEDED.md na GitHubu a vyčistit je?",
    clearFromNeededDone: (n) => {
      if (n === 1) return "Odebrán 1 hotový úkol z NEEDED.md.";
      if (n >= 2 && n <= 4) return `Odebrány ${n} hotové úkoly z NEEDED.md.`;
      return `Odebráno ${n} hotových úkolů z NEEDED.md.`;
    },
    clearFromNeededNone: "Žádné hotové NEEDED úkoly k odebrání.",
    clearFromNeededErr: "NEEDED.md se nepodařilo aktualizovat. Zkus to znovu.",
    clearingFromNeeded: "Odebírám…",
    finishedCommitMessage: (n) =>
      `chore: odebrání ${n} hotových úkolů z NEEDED.md`,
  },
};

/**
 * Czech count: 1 → singular, 2–4 → "X dny"/"X úkoly", 0 and 5+ → genitive plural.
 * Pass the three forms for one (1), few (2–4), and many (0, 5+).
 */
function csCount(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `${n} ${one}`;
  if (n >= 2 && n <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}
