type QuickAddStrings = {
  placeholder: string;
  signInFirst: string;
  titleRequired: string;
  habitNameRequired: string;
  eventTitleRequired: string;
  openedCalendarForm: string;
  addedTodo: (title: string) => string;
  couldNotAddTodo: string;
  noHabitNamed: (name: string) => string;
  alreadyDoneToday: (name: string) => string;
  markedForToday: (name: string) => string;
  couldNotMarkHabit: string;
  nlOff: string;
  couldntParse: string;
  openingCalendarForm: (title: string, date: string, time?: string) => string;
};

export const quickAdd: { en: QuickAddStrings; cs: QuickAddStrings } = {
  en: {
    placeholder: '"dinner with mom 7pm tomorrow" — or !todo / !streak / !cal',
    signInFirst: "Sign in first.",
    titleRequired: "Title is required.",
    habitNameRequired: "Habit name is required.",
    eventTitleRequired: "Event title is required.",
    openedCalendarForm: "Opened the calendar form.",
    addedTodo: (title) => `Added todo: ${title}`,
    couldNotAddTodo: "Could not add todo.",
    noHabitNamed: (name) => `No habit named "${name}".`,
    alreadyDoneToday: (name) => `${name} already done today.`,
    markedForToday: (name) => `Marked ${name} for today.`,
    couldNotMarkHabit: "Could not mark habit.",
    nlOff: "Use !todo, !streak, or !cal — NL parsing is off.",
    couldntParse: "Couldn't parse. Try !todo / !streak / !cal.",
    openingCalendarForm: (title, date, time) =>
      `Opening calendar form for "${title}" on ${date}${time ? ` at ${time}` : ""}.`,
  },
  cs: {
    placeholder: '"večeře s mámou v 19:00 zítra" — nebo !todo / !streak / !cal',
    signInFirst: "Nejprve se přihlaste.",
    titleRequired: "Název je povinný.",
    habitNameRequired: "Název návyku je povinný.",
    eventTitleRequired: "Název události je povinný.",
    openedCalendarForm: "Otevřen formulář kalendáře.",
    addedTodo: (title) => `Přidán úkol: ${title}`,
    couldNotAddTodo: "Nepodařilo se přidat úkol.",
    noHabitNamed: (name) => `Žádný návyk s názvem „${name}".`,
    alreadyDoneToday: (name) => `${name} už je dnes hotovo.`,
    markedForToday: (name) => `${name} označeno pro dnešek.`,
    couldNotMarkHabit: "Nepodařilo se označit návyk.",
    nlOff: "Použijte !todo, !streak nebo !cal — rozpoznávání textu je vypnuté.",
    couldntParse: "Nepodařilo se rozpoznat. Zkuste !todo / !streak / !cal.",
    openingCalendarForm: (title, date, time) =>
      `Otevírám formulář kalendáře pro „${title}" dne ${date}${time ? ` v ${time}` : ""}.`,
  },
};
