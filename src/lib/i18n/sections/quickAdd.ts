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
  nlOff: string;
  couldntParse: string;
  openingCalendarForm: (title: string, date: string, time?: string) => string;
};

export const quickAdd: { en: QuickAddStrings; cs: QuickAddStrings } = {
  en: {
    placeholder: '"follow up with Acme tomorrow" — or !todo / !inbox / !cal',
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
    nlOff: "Use !todo, !inbox, or !cal — AI parsing is off.",
    couldntParse: "Couldn't parse. Try !todo / !inbox / !cal.",
    openingCalendarForm: (title, date, time) =>
      `Opening calendar form for "${title}" on ${date}${time ? ` at ${time}` : ""}.`,
  },
  cs: {
    placeholder: '"follow-up s Acme zítra" — nebo !todo / !inbox / !cal',
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
    nlOff: "Použijte !todo, !inbox nebo !cal — AI rozpoznávání je vypnuté.",
    couldntParse: "Nepodařilo se rozpoznat. Zkuste !todo / !inbox / !cal.",
    openingCalendarForm: (title, date, time) =>
      `Otevírám formulář kalendáře pro „${title}" dne ${date}${time ? ` v ${time}` : ""}.`,
  },
};
