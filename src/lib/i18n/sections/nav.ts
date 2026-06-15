type NavSection =
  | "overview"
  | "calendar"
  | "notes"
  | "todos"
  | "streaks"
  | "finances"
  | "invoices"
  | "subscriptions"
  | "plans"
  | "books"
  | "dates"
  | "couple"
  | "settings";

type NavStrings = {
  brand: string;
  sections: Record<NavSection, string>;
  // Condensed labels for the mobile bottom bar; falls back to `sections`.
  short: Partial<Record<NavSection, string>>;
  theme: string;
  settings: string;
  collapse: string;
  expand: string;
  disconnectGoogle: string;
  disconnectConfirm: string;
  disconnectOk: string;
  disconnectErr: string;
  networkErr: string;
  signOut: string;
};

export const nav: { en: NavStrings; cs: NavStrings } = {
  en: {
    brand: "Dashboard",
    sections: {
      overview: "Overview",
      calendar: "Calendar",
      notes: "Notes",
      todos: "Tasks",
      streaks: "Habits",
      finances: "Finances",
      invoices: "Invoices",
      subscriptions: "Subscriptions",
      plans: "Plans",
      books: "Books",
      dates: "Dates",
      couple: "Couple",
      settings: "Settings",
    },
    short: { subscriptions: "Subs" },
    theme: "Theme",
    settings: "Settings",
    collapse: "Collapse sidebar",
    expand: "Expand sidebar",
    disconnectGoogle: "Disconnect Google",
    disconnectConfirm:
      "Disconnect Google? Calendar features will need a re-link.",
    disconnectOk: "Google disconnected.",
    disconnectErr: "Could not disconnect Google.",
    networkErr: "Network error.",
    signOut: "Sign out",
  },
  cs: {
    brand: "Dashboard",
    sections: {
      overview: "Přehled",
      calendar: "Kalendář",
      notes: "Poznámky",
      todos: "Úkoly",
      streaks: "Návyky",
      finances: "Finance",
      invoices: "Faktury",
      subscriptions: "Předplatná",
      plans: "Plány",
      books: "Knihy",
      dates: "Významné dny",
      couple: "Pár",
      settings: "Nastavení",
    },
    short: { subscriptions: "Předpl.", dates: "Dny" },
    theme: "Motiv",
    settings: "Nastavení",
    collapse: "Sbalit panel",
    expand: "Rozbalit panel",
    disconnectGoogle: "Odpojit Google",
    disconnectConfirm:
      "Odpojit Google? Funkce kalendáře budou vyžadovat opětovné propojení.",
    disconnectOk: "Google odpojen.",
    disconnectErr: "Nepodařilo se odpojit Google.",
    networkErr: "Chyba sítě.",
    signOut: "Odhlásit se",
  },
};
