type QuickAddStrings = {
  placeholder: string;
  signInFirst: string;
  titleRequired: string;
  eventTitleRequired: string;
  openedCalendarForm: string;
  addedTodo: (title: string) => string;
  couldNotAddTodo: string;
  addedInbox: (title: string) => string;
  couldNotAddInbox: string;
  confirmTodo: (title: string) => string;
  confirmInbox: (title: string) => string;
  confirmSearch: string;
  searchNeedsSensitive: string;
  searchFailed: string;
  searchAnswer: string;
  searchEvidence: string;
  searchLimitations: string;
  nlOff: string;
  couldntParse: string;
  openingCalendarForm: (title: string, date: string, time?: string) => string;
};

export const quickAdd: { en: QuickAddStrings; cs: QuickAddStrings } = {
  en: {
    placeholder: 'Add an action or ask “Which invoices are unpaid?”',
    signInFirst: "Sign in first.",
    titleRequired: "Title is required.",
    eventTitleRequired: "Event title is required.",
    openedCalendarForm: "Opened the calendar form.",
    addedTodo: (title) => `Added todo: ${title}`,
    couldNotAddTodo: "Could not add todo.",
    addedInbox: (title) => `Captured in inbox: ${title}`,
    couldNotAddInbox: "Could not capture the inbox item.",
    confirmTodo: (title) => `AI suggests creating the task “${title}”. Confirm?`,
    confirmInbox: (title) => `AI suggests capturing “${title}” in Inbox. Confirm?`,
    confirmSearch: "Search your owned work and financial records with AI? Only the minimum bounded context is sent.",
    searchNeedsSensitive: "Enable sensitive AI context in Settings to search owned records.",
    searchFailed: "The question could not be answered.",
    searchAnswer: "Answer",
    searchEvidence: "Evidence",
    searchLimitations: "Limitations",
    nlOff: "Use !todo, !inbox, or !cal — AI parsing is off.",
    couldntParse: "Couldn't parse. Try !todo / !inbox / !cal.",
    openingCalendarForm: (title, date, time) =>
      `Opening calendar form for "${title}" on ${date}${time ? ` at ${time}` : ""}.`,
  },
  cs: {
    placeholder: 'Přidejte akci nebo se zeptejte „Které faktury nejsou uhrazené?“',
    signInFirst: "Nejprve se přihlaste.",
    titleRequired: "Název je povinný.",
    eventTitleRequired: "Název události je povinný.",
    openedCalendarForm: "Otevřen formulář kalendáře.",
    addedTodo: (title) => `Přidán úkol: ${title}`,
    couldNotAddTodo: "Nepodařilo se přidat úkol.",
    addedInbox: (title) => `Zachyceno v Inboxu: ${title}`,
    couldNotAddInbox: "Položku se nepodařilo zachytit.",
    confirmTodo: (title) => `AI navrhuje vytvořit úkol „${title}“. Potvrdit?`,
    confirmInbox: (title) => `AI navrhuje zachytit „${title}“ v Inboxu. Potvrdit?`,
    confirmSearch: "Prohledat vaše vlastní pracovní a finanční záznamy pomocí AI? Odešle se jen minimální omezený kontext.",
    searchNeedsSensitive: "Pro hledání ve vlastních záznamech povolte v Nastavení citlivý AI kontext.",
    searchFailed: "Otázku se nepodařilo zodpovědět.",
    searchAnswer: "Odpověď",
    searchEvidence: "Podklady",
    searchLimitations: "Omezení",
    nlOff: "Použijte !todo, !inbox nebo !cal — AI rozpoznávání je vypnuté.",
    couldntParse: "Nepodařilo se rozpoznat. Zkuste !todo / !inbox / !cal.",
    openingCalendarForm: (title, date, time) =>
      `Otevírám formulář kalendáře pro „${title}" dne ${date}${time ? ` v ${time}` : ""}.`,
  },
};
