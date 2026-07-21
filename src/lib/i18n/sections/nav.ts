type NavSection =
  | "overview"
  | "calendar"
  | "notes"
  | "prompts"
  | "shortcuts"
  | "todos"
  | "tugedr"
  | "streaks"
  | "finances"
  | "invoices"
  | "subscriptions"
  | "plans"
  | "books"
  | "dates"
  | "couple"
  | "github"
  | "projects"
  | "costs"
  | "ai"
  | "jobs"
  | "settings";

type NavGroup = "planning" | "work" | "money" | "personal";

type NavStrings = {
  brand: string;
  sections: Record<NavSection, string>;
  // Sidebar group headings that bucket the sections into categories.
  groups: Record<NavGroup, string>;
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
      prompts: "Prompts",
      shortcuts: "Shortcuts",
      todos: "Tasks",
      tugedr: "Tugedr",
      streaks: "Habits",
      finances: "Finances",
      invoices: "Invoices",
      subscriptions: "Subscriptions",
      plans: "Plans",
      books: "Books",
      dates: "Dates",
      couple: "Couple",
      github: "Repositories",
      projects: "Projects",
      costs: "Scaling",
      ai: "AI links",
      jobs: "Jobs",
      settings: "Settings",
    },
    groups: {
      planning: "Planning",
      work: "Work",
      money: "Money",
      personal: "Personal",
    },
    short: { subscriptions: "Subs", github: "Repos", costs: "Scaling" },
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
      prompts: "Prompty",
      shortcuts: "Zkratky",
      todos: "Úkoly",
      tugedr: "Tugedr",
      streaks: "Návyky",
      finances: "Finance",
      invoices: "Faktury",
      subscriptions: "Předplatná",
      plans: "Plány",
      books: "Knihy",
      dates: "Významné dny",
      couple: "Pár",
      github: "Repozitáře",
      projects: "Projekty",
      costs: "Škálování",
      ai: "AI odkazy",
      jobs: "Práce",
      settings: "Nastavení",
    },
    groups: {
      planning: "Plánování",
      work: "Práce",
      money: "Peníze",
      personal: "Osobní",
    },
    short: { subscriptions: "Předpl.", dates: "Dny", github: "Repa", costs: "Škálování" },
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
