type OverviewStrings = {
  goodMorning: string;
  goodAfternoon: string;
  goodEvening: string;
  welcome: string;
  // date-fns format pattern; the locale object is applied separately.
  dateFormat: string;
  now: string;
  next: string;
  countdownNow: string;
  inMinutes: (m: number) => string;
  inHours: (h: number) => string;
  inHoursMinutes: (h: number, m: number) => string;
  noTitle: string;
  todaysEvents: string;
  dueToday: string;
  dueSoon: string;
  // Compact day count on a task chip, e.g. "3d". Negative n = overdue.
  daysTag: (n: number) => string;
  habitsLeft: string;
  nothingScheduled: string;
  nothingDue: string;
  noHabitsYet: string;
  allDoneToday: string;
  calendarTokenExpired: string;
  grantCalendarAccess: string;
  couldntLoadEvents: string;
  openInGoogleCalendar: string;
  overdue: string;
  dueTodayTag: string;
  atRisk: (n: number) => string;
  isToday: string;
  tomorrow: string;
  inDays: (n: number) => string;
  yearN: (n: number) => string;
};

export const overview: { en: OverviewStrings; cs: OverviewStrings } = {
  en: {
    goodMorning: "Good morning",
    goodAfternoon: "Good afternoon",
    goodEvening: "Good evening",
    welcome: "Welcome",
    dateFormat: "EEEE, MMMM d · HH:mm",
    now: "Now",
    next: "Next",
    countdownNow: "now",
    inMinutes: (m) => `in ${m}m`,
    inHours: (h) => `in ${h}h`,
    inHoursMinutes: (h, m) => `in ${h}h ${m}m`,
    noTitle: "(no title)",
    todaysEvents: "Today's events",
    dueToday: "Due today",
    dueSoon: "Due soon",
    daysTag: (n) => (n < 0 ? `${-n}d late` : n === 0 ? "today" : `${n}d`),
    habitsLeft: "Habits left",
    nothingScheduled: "Nothing scheduled.",
    nothingDue: "Nothing due.",
    noHabitsYet: "No habits yet.",
    allDoneToday: "All done today.",
    calendarTokenExpired: "Calendar token expired.",
    grantCalendarAccess: "Grant Calendar access.",
    couldntLoadEvents: "Couldn't load events.",
    openInGoogleCalendar: "Open in Google Calendar",
    overdue: "overdue",
    dueTodayTag: "today",
    atRisk: (n) => `${n}d at risk`,
    isToday: "is today",
    tomorrow: "tomorrow",
    inDays: (n) => `in ${n} days`,
    yearN: (n) => `year ${n}`,
  },
  cs: {
    goodMorning: "Dobré ráno",
    goodAfternoon: "Dobré odpoledne",
    goodEvening: "Dobrý večer",
    welcome: "Vítejte",
    dateFormat: "EEEE d. MMMM · HH:mm",
    now: "Teď",
    next: "Další",
    countdownNow: "teď",
    inMinutes: (m) => `za ${m} min`,
    inHours: (h) => `za ${h} h`,
    inHoursMinutes: (h, m) => `za ${h} h ${m} min`,
    noTitle: "(bez názvu)",
    todaysEvents: "Dnešní události",
    dueToday: "Termín dnes",
    dueSoon: "Blíží se termín",
    daysTag: (n) => (n < 0 ? `${-n} d po` : n === 0 ? "dnes" : `za ${n} d`),
    habitsLeft: "Zbývající návyky",
    nothingScheduled: "Nic naplánováno.",
    nothingDue: "Žádný termín.",
    noHabitsYet: "Zatím žádné návyky.",
    allDoneToday: "Vše dnes hotovo.",
    calendarTokenExpired: "Token kalendáře vypršel.",
    grantCalendarAccess: "Povolte přístup ke Kalendáři.",
    couldntLoadEvents: "Nepodařilo se načíst události.",
    openInGoogleCalendar: "Otevřít v Kalendáři Google",
    overdue: "po termínu",
    dueTodayTag: "dnes",
    atRisk: (n) => `${n} d v ohrožení`,
    isToday: "je dnes",
    tomorrow: "zítra",
    inDays: (n) => `za ${n} dní`,
    yearN: (n) => `rok ${n}`,
  },
};
