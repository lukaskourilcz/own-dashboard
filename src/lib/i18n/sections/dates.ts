type DatesStrings = {
  title: string;
  description: string;
  editDate: string;
  addDate: string;
  titleLabel: string;
  titlePlaceholder: string;
  date: string;
  emoji: string;
  repeats: string;
  yearly: string;
  monthly: string;
  notes: string;
  notesPlaceholder: string;
  project: string;
  organization: string;
  noProject: string;
  noOrganization: string;
  comingUp: string;
  noDatesYet: string;
  noDatesYetDescription: string;
  everyMonth: string;
  turning: (n: number) => string;
  yearlyLabel: string;
  oneOff: string;
  titleAndDateRequired: string;
  couldNotSave: string;
  updated: string;
  added: (title: string) => string;
  // date-fns format pattern for the next-occurrence date.
  nextDateFormat: string;
  // Countdown labels (mirror of countdownLabel in @/lib/important-dates).
  today: string;
  tomorrow: string;
  daysAgo: (n: number) => string;
  inDays: (n: number) => string;
  inWeeks: (n: number) => string;
  inMonths: (n: number) => string;
};

export const dates: { en: DatesStrings; cs: DatesStrings } = {
  en: {
    title: "Dates",
    description: "Professional deadlines, launches, renewals, and milestones.",
    editDate: "Edit date",
    addDate: "Add a date",
    titleLabel: "Title",
    titlePlaceholder: "Contract renewal",
    date: "Date",
    emoji: "Emoji",
    repeats: "Repeats",
    yearly: "Yearly",
    monthly: "Monthly",
    notes: "Notes",
    notesPlaceholder: "Optional",
    project: "Project",
    organization: "Organization",
    noProject: "No project",
    noOrganization: "No organization",
    comingUp: "Coming up",
    noDatesYet: "No dates yet",
    noDatesYetDescription:
      "Add a contract deadline, project launch, interview, renewal, or professional milestone.",
    everyMonth: "every month",
    turning: (n) => `turning ${n}`,
    yearlyLabel: "yearly",
    oneOff: "one-off",
    titleAndDateRequired: "Title and date are required.",
    couldNotSave: "Could not save.",
    updated: "Updated.",
    added: (title) => `Added "${title}".`,
    nextDateFormat: "MMM d",
    today: "today",
    tomorrow: "tomorrow",
    daysAgo: (n) => `${n}d ago`,
    inDays: (n) => `in ${n}d`,
    inWeeks: (n) => `in ${n}w`,
    inMonths: (n) => `in ${n}mo`,
  },
  cs: {
    title: "Významné dny",
    description: "Profesní termíny, spuštění, obnovy a milníky.",
    editDate: "Upravit den",
    addDate: "Přidat den",
    titleLabel: "Název",
    titlePlaceholder: "Obnova smlouvy",
    date: "Datum",
    emoji: "Emoji",
    repeats: "Opakuje se",
    yearly: "Ročně",
    monthly: "Měsíčně",
    notes: "Poznámky",
    notesPlaceholder: "Volitelné",
    project: "Projekt",
    organization: "Organizace",
    noProject: "Bez projektu",
    noOrganization: "Bez organizace",
    comingUp: "Nadcházející",
    noDatesYet: "Zatím žádné dny",
    noDatesYetDescription:
      "Přidejte termín smlouvy, spuštění projektu, pohovor, obnovu nebo profesní milník.",
    everyMonth: "každý měsíc",
    turning: (n) => `bude mu ${n}`,
    yearlyLabel: "ročně",
    oneOff: "jednorázové",
    titleAndDateRequired: "Název a datum jsou povinné.",
    couldNotSave: "Nepodařilo se uložit.",
    updated: "Upraveno.",
    added: (title) => `Přidáno „${title}“.`,
    nextDateFormat: "d. MMM",
    today: "dnes",
    tomorrow: "zítra",
    daysAgo: (n) => `před ${n} d`,
    inDays: (n) => `za ${n} d`,
    inWeeks: (n) => `za ${n} týd`,
    inMonths: (n) => `za ${n} měs`,
  },
};
