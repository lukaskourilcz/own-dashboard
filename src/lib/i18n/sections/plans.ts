type PlanStatus = "idea" | "active" | "done" | "dropped";

type PlansStrings = {
  title: string;
  description: string;
  board: string;
  timeline: string;
  newPlan: string;
  formTitle: string;
  titlePlaceholder: string;
  targetDate: string;
  status: string;
  statusLabel: Record<PlanStatus, string>;
  notes: string;
  notesPlaceholder: string;
  addToCalendar: string;
  titleRequired: string;
  targetDateRequiredForCalendar: string;
  couldNotSavePlan: string;
  calendarEventFailed: string;
  saving: string;
  addPlan: string;
  statusBoard: string;
  noPlansYet: string;
  noPlansDescription: string;
  empty: string;
  changeStatus: string;
  deletePlan: string;
  cal: string;
  /** Date-fns format string for the timeline date (locale-aware). */
  timelineDateFormat: string;
  today: string;
  inDays: (d: number) => string;
  daysAgo: (d: number) => string;
  noDate: string;
};

export const plans: { en: PlansStrings; cs: PlansStrings } = {
  en: {
    title: "Plans",
    description: "What you're working toward.",
    board: "Board",
    timeline: "Timeline",
    newPlan: "New plan",
    formTitle: "Title",
    titlePlaceholder: "Ship the side project",
    targetDate: "Target date",
    status: "Status",
    statusLabel: {
      idea: "Idea",
      active: "Active",
      done: "Done",
      dropped: "Dropped",
    },
    notes: "Notes",
    notesPlaceholder: "Optional",
    addToCalendar: "Add as a Google Calendar event",
    titleRequired: "Title is required.",
    targetDateRequiredForCalendar:
      "Target date is required to add to calendar.",
    couldNotSavePlan: "Could not save plan.",
    calendarEventFailed:
      "Plan saved, but the calendar event couldn't be created.",
    saving: "Saving…",
    addPlan: "Add plan",
    statusBoard: "Status board",
    noPlansYet: "No plans yet",
    noPlansDescription: "Add one on the left to start tracking your goals.",
    empty: "empty",
    changeStatus: "Change status",
    deletePlan: "Delete plan",
    cal: "cal",
    timelineDateFormat: "MMM d",
    today: "today",
    inDays: (d) => `in ${d}d`,
    daysAgo: (d) => `${d}d ago`,
    noDate: "no date",
  },
  cs: {
    title: "Plány",
    description: "Na čem pracuješ.",
    board: "Nástěnka",
    timeline: "Časová osa",
    newPlan: "Nový plán",
    formTitle: "Název",
    titlePlaceholder: "Dokončit vedlejší projekt",
    targetDate: "Cílové datum",
    status: "Stav",
    statusLabel: {
      idea: "Nápad",
      active: "Aktivní",
      done: "Hotovo",
      dropped: "Zrušeno",
    },
    notes: "Poznámky",
    notesPlaceholder: "Volitelné",
    addToCalendar: "Přidat jako událost do Kalendáře Google",
    titleRequired: "Název je povinný.",
    targetDateRequiredForCalendar:
      "Pro přidání do kalendáře je nutné cílové datum.",
    couldNotSavePlan: "Plán se nepodařilo uložit.",
    calendarEventFailed:
      "Plán byl uložen, ale událost v kalendáři se nepodařilo vytvořit.",
    saving: "Ukládání…",
    addPlan: "Přidat plán",
    statusBoard: "Nástěnka stavů",
    noPlansYet: "Zatím žádné plány",
    noPlansDescription: "Přidejte plán vlevo a začněte sledovat své cíle.",
    empty: "prázdné",
    changeStatus: "Změnit stav",
    deletePlan: "Smazat plán",
    cal: "kal",
    timelineDateFormat: "d. MMM",
    today: "dnes",
    inDays: (d) => `za ${d} d`,
    daysAgo: (d) => `před ${d} d`,
    noDate: "bez data",
  },
};
