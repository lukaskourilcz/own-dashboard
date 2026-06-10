type BookStatus = "active" | "paused" | "done";

type BooksStrings = {
  title: string;
  description: string;
  cancel: string;
  newBook: string;
  formTitle: string;
  titlePlaceholder: string;
  targetPages: string;
  targetPagesPlaceholder: string;
  startDate: string;
  coReadWith: (partner: string) => string;
  addBook: string;
  noActiveBook: string;
  noActiveBookDescription: string;
  pastAndPaused: string;
  statusLabel: Record<BookStatus, string>;
  resume: string;
  /** "{n} pages" — Czech plural-aware. */
  pagesCount: (n: number) => string;
  /** "{total} / {target} pages" — Czech plural-aware on the target. */
  pagesProgress: (total: number, target: number) => string;
  startedOn: (date: string) => string;
  shared: string;
  solo: string;
  markAsDone: string;
  done: string;
  pause: string;
  pauseBook: string;
  deleteBook: string;
  delete: string;
  deleteConfirm: (title: string) => string;
  percentOfTarget: (percent: number) => string;
  youSuffix: (name: string) => string;
  todayDelta: (delta: number) => string;
  pagesToday: string;
  pagesTodayPlaceholder: string;
  note: string;
  notePlaceholder: string;
  log: string;
  /** Date-fns format string for the chart bucket label (locale-aware). */
  chartDateFormat: string;
  pagesTooltip: (value: number) => string;
  titleRequiredToast: string;
  targetPagesPositiveToast: string;
  couldNotAddBook: string;
  addedToast: (title: string) => string;
  pagesPositiveToast: string;
  couldNotLogPages: string;
  loggedToast: (n: number, title: string) => string;
};

export const books: { en: BooksStrings; cs: BooksStrings } = {
  en: {
    title: "Books",
    description: "What you're reading, page by page.",
    cancel: "Cancel",
    newBook: "New book",
    formTitle: "Title",
    titlePlaceholder: "Untitled novel",
    targetPages: "Target pages",
    targetPagesPlaceholder: "300",
    startDate: "Start date",
    coReadWith: (partner) => `Co-read with ${partner}`,
    addBook: "Add book",
    noActiveBook: "No active book",
    noActiveBookDescription: `Click "New book" to start one.`,
    pastAndPaused: "Past and paused",
    statusLabel: { active: "active", paused: "paused", done: "done" },
    resume: "Resume",
    pagesCount: (n) => `${n} ${n === 1 ? "page" : "pages"}`,
    pagesProgress: (total, target) =>
      `${total} / ${target} ${target === 1 ? "page" : "pages"}`,
    startedOn: (date) => `started ${date}`,
    shared: "shared",
    solo: "Solo book",
    markAsDone: "Mark as done",
    done: "Done",
    pause: "Pause",
    pauseBook: "Pause book",
    deleteBook: "Delete book",
    delete: "Delete",
    deleteConfirm: (title) => `Delete "${title}" and all its page logs?`,
    percentOfTarget: (percent) => `${percent}% of target`,
    youSuffix: (name) => `${name} (you)`,
    todayDelta: (delta) => `today ${delta > 0 ? `+${delta}` : "0"}`,
    pagesToday: "Pages today",
    pagesTodayPlaceholder: "3",
    note: "Note",
    notePlaceholder: "Optional",
    log: "Log",
    chartDateFormat: "MMM d",
    pagesTooltip: (value) => `${value} pages`,
    titleRequiredToast: "Title is required.",
    targetPagesPositiveToast: "Target pages must be a positive number.",
    couldNotAddBook: "Could not add book.",
    addedToast: (title) => `Added "${title}".`,
    pagesPositiveToast: "Pages must be a positive number.",
    couldNotLogPages: "Could not log pages.",
    loggedToast: (n, title) =>
      `+${n} page${n === 1 ? "" : "s"} on "${title}"`,
  },
  cs: {
    title: "Knihy",
    description: "Co čteš, stránku po stránce.",
    cancel: "Zrušit",
    newBook: "Nová kniha",
    formTitle: "Název",
    titlePlaceholder: "Nepojmenovaný román",
    targetPages: "Cílový počet stran",
    targetPagesPlaceholder: "300",
    startDate: "Datum začátku",
    coReadWith: (partner) => `Číst společně s ${partner}`,
    addBook: "Přidat knihu",
    noActiveBook: "Žádná aktivní kniha",
    noActiveBookDescription: `Klikněte na „Nová kniha“ a začněte.`,
    pastAndPaused: "Dokončené a pozastavené",
    statusLabel: {
      active: "aktivní",
      paused: "pozastaveno",
      done: "hotovo",
    },
    resume: "Pokračovat",
    pagesCount: (n) =>
      `${n} ${n === 1 ? "stránka" : n >= 2 && n <= 4 ? "stránky" : "stránek"}`,
    pagesProgress: (total, target) =>
      `${total} / ${target} ${
        target === 1 ? "stránka" : target >= 2 && target <= 4 ? "stránky" : "stránek"
      }`,
    startedOn: (date) => `začátek ${date}`,
    shared: "sdílené",
    solo: "Vlastní kniha",
    markAsDone: "Označit jako hotové",
    done: "Hotovo",
    pause: "Pozastavit",
    pauseBook: "Pozastavit knihu",
    deleteBook: "Smazat knihu",
    delete: "Smazat",
    deleteConfirm: (title) =>
      `Smazat „${title}“ a všechny záznamy stránek?`,
    percentOfTarget: (percent) => `${percent} % z cíle`,
    youSuffix: (name) => `${name} (ty)`,
    todayDelta: (delta) => `dnes ${delta > 0 ? `+${delta}` : "0"}`,
    pagesToday: "Stránky dnes",
    pagesTodayPlaceholder: "3",
    note: "Poznámka",
    notePlaceholder: "Volitelné",
    log: "Zaznamenat",
    chartDateFormat: "d. MMM",
    pagesTooltip: (value) =>
      `${value} ${value === 1 ? "stránka" : value >= 2 && value <= 4 ? "stránky" : "stránek"}`,
    titleRequiredToast: "Název je povinný.",
    targetPagesPositiveToast: "Cílový počet stran musí být kladné číslo.",
    couldNotAddBook: "Knihu se nepodařilo přidat.",
    addedToast: (title) => `Přidáno „${title}“.`,
    pagesPositiveToast: "Počet stran musí být kladné číslo.",
    couldNotLogPages: "Stránky se nepodařilo zaznamenat.",
    loggedToast: (n, title) =>
      `+${n} ${n === 1 ? "stránka" : n >= 2 && n <= 4 ? "stránky" : "stránek"} v „${title}“`,
  },
};
