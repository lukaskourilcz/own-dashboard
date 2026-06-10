type StreaksStrings = {
  title: string;
  description: string;
  compactTitle: string;
  noHabitsYet: string;
  trackDailyHabit: string;
  newHabit: string;
  name: string;
  namePlaceholder: string;
  color: string;
  colorAria: (color: string) => string;
  reminder: string;
  addHabit: string;
  yourHabits: string;
  addHabitDescription: string;
  current: string;
  best: string;
  currentCount: (n: number) => string;
  bestCount: (n: number) => string;
  markToday: string;
  doneToday: string;
  partnerHabits: (name: string) => string;
  partnerFallback: string;
  currentVsBest: (current: number, best: number) => string;
  doneTag: string;
  notDoneTag: string;
  // date-fns format pattern for date tooltips; the locale object is applied separately.
  dateFormat: string;
};

export const streaks: { en: StreaksStrings; cs: StreaksStrings } = {
  en: {
    title: "Habits",
    description: "Daily check-ins. Don't break the chain.",
    compactTitle: "Habits",
    noHabitsYet: "No habits yet",
    trackDailyHabit: "Track a daily habit in the Habits tab.",
    newHabit: "New habit",
    name: "Name",
    namePlaceholder: "Read 30 min",
    color: "Color",
    colorAria: (color) => `Color ${color}`,
    reminder: "Reminder",
    addHabit: "Add habit",
    yourHabits: "Your habits",
    addHabitDescription: "Add a habit on the left and start checking in daily.",
    current: "current",
    best: "best",
    currentCount: (n) => `${n} current`,
    bestCount: (n) => `${n} best`,
    markToday: "Mark today",
    doneToday: "Done today",
    partnerHabits: (name) => `${name}'s habits`,
    partnerFallback: "Partner",
    currentVsBest: (current, best) => `${current} current · ${best} best`,
    doneTag: "done",
    notDoneTag: "—",
    dateFormat: "d MMM yyyy",
  },
  cs: {
    title: "Návyky",
    description: "Denní odškrtnutí. Nepřeruš sérii.",
    compactTitle: "Návyky",
    noHabitsYet: "Zatím žádné návyky",
    trackDailyHabit: "Sleduj denní návyk v sekci Návyky.",
    newHabit: "Nový návyk",
    name: "Název",
    namePlaceholder: "Číst 30 min",
    color: "Barva",
    colorAria: (color) => `Barva ${color}`,
    reminder: "Připomínka",
    addHabit: "Přidat návyk",
    yourHabits: "Tvé návyky",
    addHabitDescription: "Přidej návyk vlevo a začni se denně odškrtávat.",
    current: "aktuální",
    best: "nejlepší",
    currentCount: (n) => `${n} aktuální`,
    bestCount: (n) => `${n} nejlepší`,
    markToday: "Označit dnešek",
    doneToday: "Hotovo dnes",
    partnerHabits: (name) => `Návyky: ${name}`,
    partnerFallback: "Partner",
    currentVsBest: (current, best) =>
      `${current} aktuální · ${best} nejlepší`,
    doneTag: "hotovo",
    notDoneTag: "—",
    dateFormat: "d. MMM yyyy",
  },
};
