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
