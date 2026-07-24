import type { TaskKind, TimeBucketId } from "@/lib/task-meta";

type TodosStrings = {
  title: string;
  description: string;
  compactTitle: string;
  openDoneCount: (open: number, done: number) => string;
  allClear: string;
  allClearDescription: string;
  addTask: string;
  addTaskTitle: string;
  taskLabel: string;
  whatNeedsDoing: string;
  dueDate: string;
  project: string;
  organization: string;
  noProject: string;
  noOrganization: string;
  allTasks: string;
  nothingOnPlate: string;
  nothingOnPlateDescription: string;
  quickAddPlaceholder: string;
  due: (date: string) => string;
  // date-fns format pattern for due dates; the locale object is applied separately.
  dueDateFormat: string;
  otherCategory: string;
  // Personal (hand-added) tasks group heading in the repo-card layout.
  personalGroup: string;
  // Overview "tasks by category" card.
  byCategory: string;
  remainingLabel: string;
  totalOpen: (n: number) => string;
  moreTasks: (n: number) => string;
  openAll: string;
  categoryClear: string;
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
  showAllCount: (n: number) => string;
  showLess: string;
  collapseGroup: string;
  expandGroup: string;
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
  // Importance scoring + filter
  importanceLabel: string;
  importanceNone: string;
  importanceOption: (n: number) => string;
  importanceOf: (n: number) => string;
  importanceFilterLabel: string;
  filterAll: string;
  filterMin: (n: number) => string;
  filterHidden: (n: number) => string;
  assigneeFilterLabel: string;
  assigneeMe: string;
  assigneeAi: string;
  // Work-kind (category) + time-estimate labels, filters, and tags.
  taskKindLabel: (kind: TaskKind) => string;
  categoryFilterLabel: string;
  categoryLabel: string;
  categoryNone: string;
  timeFilterLabel: string;
  timeBucketLabel: (id: TimeBucketId) => string;
  timeLabel: string;
  timeNone: string;
  timeMinutesUnit: string;
  estimatedTimeLabel: (value: string) => string;
  filterEmptyTitle: string;
  filterEmptyDescription: (n: number) => string;
  filtersEmpty: string;
  globalGroup: string;
  globalTask: string;
  dailyFocusTitle: string;
  dailyFocusDescription: string;
  dailyFocusProgress: (done: number, total: number) => string;
  regenerateDailyFocus: string;
  regeneratingDailyFocus: string;
  dailyFocusEmpty: string;
  dailyFocusEmptyDescription: string;
  dailyFocusUnavailable: string;
  dailyFocusUnavailableDescription: string;
  dailyFocusRefreshErr: string;
  dailyFocusRetry: string;
  waitingFor: (duration: string) => string;
  completionGarden: string;
  completionGardenDescription: string;
  completedDay: string;
  incompleteDay: string;
  deleteTaskConfirm: string;
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
    taskLabel: "Task",
    whatNeedsDoing: "What needs doing?",
    dueDate: "Due date",
    project: "Project",
    organization: "Organization",
    noProject: "No project",
    noOrganization: "No organization",
    allTasks: "All tasks",
    nothingOnPlate: "Nothing on your plate",
    nothingOnPlateDescription: "Add a task on the left to get started.",
    quickAddPlaceholder: "Add a task…",
    due: (date) => `due ${date}`,
    dueDateFormat: "d MMM",
    otherCategory: "Other",
    personalGroup: "Manual tasks",
    byCategory: "By category",
    remainingLabel: "left",
    totalOpen: (n) => (n === 1 ? "1 task open" : `${n} tasks open`),
    moreTasks: (n) => `+${n} more`,
    openAll: "Open all",
    categoryClear: "All done",
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
    showAllCount: (n) => `Show all ${n}`,
    showLess: "Show less",
    collapseGroup: "Collapse",
    expandGroup: "Expand",
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
    importanceLabel: "Importance",
    importanceNone: "Importance — none",
    importanceOption: (n) =>
      `Importance ${n}${n === 6 ? " (GLOBAL)" : n === 5 ? " (highest project)" : ""}`,
    importanceOf: (n) => `Importance ${n}/6`,
    importanceFilterLabel: "Importance",
    filterAll: "All",
    filterMin: (n) => (n === 5 ? "5" : `${n}+`),
    filterHidden: (n) => `${n} hidden`,
    assigneeFilterLabel: "For",
    assigneeMe: "Me",
    assigneeAi: "AI",
    taskKindLabel: (kind) =>
      ({
        setup: "Setup",
        deploy: "Deploy",
        legal: "Legal",
        content: "Content",
        decision: "Decision",
      })[kind],
    categoryFilterLabel: "Category",
    categoryLabel: "Category",
    categoryNone: "No category",
    timeFilterLabel: "Time",
    timeBucketLabel: (id) => ({ q: "≤15m", h: "≤1h", half: "≤4h" })[id],
    timeLabel: "Time estimate",
    timeNone: "No estimate",
    timeMinutesUnit: "min",
    estimatedTimeLabel: (value) => `Est. ${value}`,
    filterEmptyTitle: "Nothing at this importance",
    filterEmptyDescription: (n) =>
      `No open tasks scored ${n} or higher. Lower the filter to see more.`,
    filtersEmpty: "No tasks match the current filters.",
    globalGroup: "GLOBAL",
    globalTask: "Global task",
    dailyFocusTitle: "Today's seven",
    dailyFocusDescription:
      "A daily focus drawn from active projects, highest priority first.",
    dailyFocusProgress: (done, total) => `${done} of ${total} completed`,
    regenerateDailyFocus: "Generate a new seven",
    regeneratingDailyFocus: "Generating…",
    dailyFocusEmpty: "No tasks to draw",
    dailyFocusEmptyDescription:
      "Add an open global task or a task in an active project.",
    dailyFocusUnavailable: "Today's seven is unavailable",
    dailyFocusUnavailableDescription:
      "The focus snapshot could not be loaded. Apply the latest database migrations or try again.",
    dailyFocusRefreshErr:
      "Tasks were refreshed, but today's seven could not be regenerated.",
    dailyFocusRetry: "Try again",
    waitingFor: (duration) => `Waiting ${duration}`,
    completionGarden: "Completion garden",
    completionGardenDescription:
      "A green day means all seven selected tasks were completed.",
    completedDay: "All seven completed",
    incompleteDay: "Daily focus not completed",
    deleteTaskConfirm: "This task will be permanently deleted.",
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
    taskLabel: "Úkol",
    whatNeedsDoing: "Co je potřeba udělat?",
    dueDate: "Termín",
    project: "Projekt",
    organization: "Organizace",
    noProject: "Bez projektu",
    noOrganization: "Bez organizace",
    allTasks: "Všechny úkoly",
    nothingOnPlate: "Nemáš nic na práci",
    nothingOnPlateDescription: "Přidej úkol vlevo a začni.",
    quickAddPlaceholder: "Přidat úkol…",
    due: (date) => `termín ${date}`,
    dueDateFormat: "d. MMM",
    otherCategory: "Ostatní",
    personalGroup: "Ruční úkoly",
    byCategory: "Podle kategorie",
    remainingLabel: "zbývá",
    totalOpen: (n) => {
      if (n === 1) return "1 otevřený úkol";
      if (n >= 2 && n <= 4) return `${n} otevřené úkoly`;
      return `${n} otevřených úkolů`;
    },
    moreTasks: (n) => `+${n} dalších`,
    openAll: "Zobrazit vše",
    categoryClear: "Hotovo",
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
    showAllCount: (n) => `Zobrazit vše (${n})`,
    showLess: "Zobrazit méně",
    collapseGroup: "Sbalit",
    expandGroup: "Rozbalit",
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
    importanceLabel: "Důležitost",
    importanceNone: "Důležitost — žádná",
    importanceOption: (n) =>
      `Důležitost ${n}${n === 6 ? " (GLOBÁLNÍ)" : n === 5 ? " (nejvyšší projektová)" : ""}`,
    importanceOf: (n) => `Důležitost ${n}/6`,
    importanceFilterLabel: "Důležitost",
    filterAll: "Vše",
    filterMin: (n) => (n === 5 ? "5" : `${n}+`),
    filterHidden: (n) => {
      if (n === 1) return "1 skrytý";
      if (n >= 2 && n <= 4) return `${n} skryté`;
      return `${n} skrytých`;
    },
    filterEmptyTitle: "Nic s touto důležitostí",
    filterEmptyDescription: (n) =>
      `Žádné otevřené úkoly s důležitostí ${n} a vyšší. Sniž filtr a uvidíš víc.`,
    filtersEmpty: "Žádné úkoly neodpovídají zvoleným filtrům.",
    assigneeFilterLabel: "Pro",
    assigneeMe: "Já",
    assigneeAi: "AI",
    taskKindLabel: (kind) =>
      ({
        setup: "Nastavení",
        deploy: "Nasazení",
        legal: "Právní",
        content: "Obsah",
        decision: "Rozhodnutí",
      })[kind],
    categoryFilterLabel: "Kategorie",
    categoryLabel: "Kategorie",
    categoryNone: "Bez kategorie",
    timeFilterLabel: "Čas",
    timeBucketLabel: (id) => ({ q: "≤15m", h: "≤1h", half: "≤4h" })[id],
    timeLabel: "Odhad času",
    timeNone: "Bez odhadu",
    timeMinutesUnit: "min",
    estimatedTimeLabel: (value) => `Odhad ${value}`,
    globalGroup: "GLOBÁLNÍ",
    globalTask: "Globální úkol",
    dailyFocusTitle: "Dnešní sedmička",
    dailyFocusDescription:
      "Denní výběr z aktivních projektů, nejvyšší priority mají přednost.",
    dailyFocusProgress: (done, total) => `Hotovo ${done} z ${total}`,
    regenerateDailyFocus: "Vygenerovat novou sedmičku",
    regeneratingDailyFocus: "Generuji…",
    dailyFocusEmpty: "Není z čeho vybírat",
    dailyFocusEmptyDescription:
      "Přidej otevřený globální úkol nebo úkol v aktivním projektu.",
    dailyFocusUnavailable: "Dnešní sedmička není dostupná",
    dailyFocusUnavailableDescription:
      "Výběr se nepodařilo načíst. Použij nejnovější databázové migrace nebo to zkus znovu.",
    dailyFocusRefreshErr:
      "Úkoly byly obnoveny, ale dnešní sedmičku se nepodařilo vygenerovat.",
    dailyFocusRetry: "Zkusit znovu",
    waitingFor: (duration) => `Čeká ${duration}`,
    completionGarden: "Zahrada dokončení",
    completionGardenDescription:
      "Zelený den znamená, že bylo dokončeno všech sedm vybraných úkolů.",
    completedDay: "Všech sedm dokončeno",
    incompleteDay: "Denní výběr nebyl dokončen",
    deleteTaskConfirm: "Tento úkol bude nenávratně smazán.",
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
