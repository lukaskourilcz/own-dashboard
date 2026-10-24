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
  endAfterStart: string;
  resultUnconfirmed: string;
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
  retry: string;
  selectionLimit: string;
  showMore: string;
  showingEvents: (shown: number, total: number) => string;
};

export const calendar: { en: CalendarStrings; cs: CalendarStrings } = {
  en: {
    showMore: "Show more",
    showingEvents: (shown, total) => `${shown} of ${total} events`,
    retry: "Retry",
    selectionLimit: "Choose up to 20 calendars.",
    resultUnconfirmed: "The calendar result was not confirmed. Check Google Calendar before creating another event.",
    endAfterStart: "End time must be after start time.",
    newEvent: "New calendar event",
    title: "Title",
    titlePlaceholder: "Project review",
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
    tokenRejected: "Calendar access expired. Reconnect Google to continue.",
    eventAdded: "Event added to your Google Calendar.",
    open: "Open",
    adding: "Adding…",
    addToGoogleCalendar: "Add to Google Calendar",
    next7Days: "Next 7 days",
    dayHeadingFormat: "EEEE, MMM d",
    errUnauthorized: "Calendar access expired. Reconnect Google to load events.",
    errNoToken: "Connect Google to load your calendar.",
    errLoad: "Couldn't load events from Google.",
    nothingScheduled: "Nothing scheduled",
    weekWideOpen: "Your week is wide open.",
    today: "Today",
    allDayLabel: "all day",
    noTitle: "(no title)",
    repeats: "repeats",
    openInGoogleCalendar: "Open in Google Calendar",
    couldNotLoadCalendars: "Could not load calendars.",
    selectionSaved: "Calendar selection saved.",
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
    showMore: "Zobrazit další",
    showingEvents: (shown, total) => `${shown} z ${total} událostí`,
    retry: "Zkusit znovu",
    selectionLimit: "Vyberte nejvýše 20 kalendářů.",
    resultUnconfirmed: "Výsledek nebyl potvrzen. Než vytvoříte další událost, zkontrolujte Kalendář Google.",
    endAfterStart: "Konec musí být po začátku.",
    newEvent: "Nová událost v kalendáři",
    title: "Název",
    titlePlaceholder: "Kontrola projektu",
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
      "Přístup ke kalendáři vypršel. Pro pokračování znovu propojte Google.",
    eventAdded: "Událost byla přidána do Kalendáře Google.",
    open: "Otevřít",
    adding: "Přidávání…",
    addToGoogleCalendar: "Přidat do Kalendáře Google",
    next7Days: "Příštích 7 dní",
    dayHeadingFormat: "EEEE d. MMMM",
    errUnauthorized: "Přístup ke kalendáři vypršel. Pro načtení událostí znovu propojte Google.",
    errNoToken: "Pro načtení kalendáře propojte Google.",
    errLoad: "Události z Google se nepodařilo načíst.",
    nothingScheduled: "Nic naplánováno",
    weekWideOpen: "Tvůj týden je úplně volný.",
    today: "Dnes",
    allDayLabel: "celý den",
    noTitle: "(bez názvu)",
    repeats: "opakuje se",
    openInGoogleCalendar: "Otevřít v Kalendáři Google",
    couldNotLoadCalendars: "Kalendáře se nepodařilo načíst.",
    selectionSaved: "Výběr kalendářů uložen.",
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
