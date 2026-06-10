type Recurrence = "none" | "daily" | "weekly" | "monthly";

type CalendarStrings = {
  // CalendarPanel
  newEvent: string;
  title: string;
  titlePlaceholder: string;
  date: string;
  start: string;
  end: string;
  allDay: string;
  recurrence: Record<Recurrence, string>;
  description: string;
  descriptionPlaceholder: string;
  titleAndDateRequired: string;
  startAndEndRequired: string;
  couldNotCreateEvent: string;
  tokenRejected: string;
  eventAdded: string;
  open: string;
  adding: string;
  addToGoogleCalendar: string;
  // WeekView
  next7Days: string;
  dayHeadingFormat: string;
  errUnauthorized: string;
  errNoToken: string;
  errLoad: string;
  nothingScheduled: string;
  weekWideOpen: string;
  today: string;
  allDayLabel: string;
  noTitle: string;
  repeats: string;
  openInGoogleCalendar: string;
  // CalendarPicker
  couldNotLoadCalendars: string;
  selectionSaved: string;
  couldNotSaveSelection: string;
  calendarsToShow: string;
  loading: string;
  noCalendarsFound: string;
  primary: string;
  primaryLabel: string;
  countSelected: (n: number) => string;
  cancel: string;
  saving: string;
  save: string;
};

export const calendar: { en: CalendarStrings; cs: CalendarStrings } = {
  en: {
    newEvent: "New calendar event",
    title: "Title",
    titlePlaceholder: "Dentist appointment",
    date: "Date",
    start: "Start",
    end: "End",
    allDay: "All day",
    recurrence: {
      none: "Doesn't repeat",
      daily: "Daily",
      weekly: "Weekly",
      monthly: "Monthly",
    },
    description: "Description",
    descriptionPlaceholder: "Optional",
    titleAndDateRequired: "Title and date are required.",
    startAndEndRequired: "Start and end time are required.",
    couldNotCreateEvent: "Could not create event.",
    tokenRejected: "Google rejected the calendar token. Re-link to refresh access.",
    eventAdded: "Event added to your Google Calendar.",
    open: "Open",
    adding: "Adding…",
    addToGoogleCalendar: "Add to Google Calendar",
    next7Days: "Next 7 days",
    dayHeadingFormat: "EEEE, MMM d",
    errUnauthorized: "Google rejected the calendar token.",
    errNoToken: "We don't have a Calendar token yet.",
    errLoad: "Couldn't load events from Google.",
    nothingScheduled: "Nothing scheduled",
    weekWideOpen: "Your week is wide open.",
    today: "Today",
    allDayLabel: "all day",
    noTitle: "(no title)",
    repeats: "repeats",
    openInGoogleCalendar: "Open in Google Calendar",
    couldNotLoadCalendars: "Could not load calendars.",
    selectionSaved: "Calendar selection saved. Reload to see changes.",
    couldNotSaveSelection: "Could not save selection.",
    calendarsToShow: "Calendars to show",
    loading: "Loading…",
    noCalendarsFound: "No calendars found.",
    primary: "primary",
    primaryLabel: "Primary",
    countSelected: (n) => `${n} selected`,
    cancel: "Cancel",
    saving: "Saving…",
    save: "Save",
  },
  cs: {
    newEvent: "Nová událost v kalendáři",
    title: "Název",
    titlePlaceholder: "Návštěva zubaře",
    date: "Datum",
    start: "Začátek",
    end: "Konec",
    allDay: "Celodenní",
    recurrence: {
      none: "Neopakuje se",
      daily: "Denně",
      weekly: "Týdně",
      monthly: "Měsíčně",
    },
    description: "Popis",
    descriptionPlaceholder: "Volitelné",
    titleAndDateRequired: "Název a datum jsou povinné.",
    startAndEndRequired: "Začátek a konec jsou povinné.",
    couldNotCreateEvent: "Událost se nepodařilo vytvořit.",
    tokenRejected:
      "Google odmítl token kalendáře. Pro obnovení přístupu se znovu propojte.",
    eventAdded: "Událost byla přidána do Kalendáře Google.",
    open: "Otevřít",
    adding: "Přidávání…",
    addToGoogleCalendar: "Přidat do Kalendáře Google",
    next7Days: "Příštích 7 dní",
    dayHeadingFormat: "EEEE d. MMMM",
    errUnauthorized: "Google odmítl token kalendáře.",
    errNoToken: "Zatím nemáme token kalendáře.",
    errLoad: "Události z Google se nepodařilo načíst.",
    nothingScheduled: "Nic naplánováno",
    weekWideOpen: "Tvůj týden je úplně volný.",
    today: "Dnes",
    allDayLabel: "celý den",
    noTitle: "(bez názvu)",
    repeats: "opakuje se",
    openInGoogleCalendar: "Otevřít v Kalendáři Google",
    couldNotLoadCalendars: "Kalendáře se nepodařilo načíst.",
    selectionSaved: "Výběr kalendářů uložen. Pro zobrazení změn obnovte stránku.",
    couldNotSaveSelection: "Výběr se nepodařilo uložit.",
    calendarsToShow: "Kalendáře k zobrazení",
    loading: "Načítání…",
    noCalendarsFound: "Žádné kalendáře nenalezeny.",
    primary: "hlavní",
    primaryLabel: "Hlavní",
    countSelected: (n) =>
      n >= 2 && n <= 4 ? `${n} vybrané` : `${n} vybraných`,
    cancel: "Zrušit",
    saving: "Ukládání…",
    save: "Uložit",
  },
};
