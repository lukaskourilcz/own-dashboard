import { brandConfig } from "@/lib/brand";
import type { NavTab } from "@/lib/nav-tabs";

type NavGroup = "work" | "money" | "planning" | "library";

type NavStrings = {
  brand: string;
  sections: Record<NavTab, string>;
  groups: Record<NavGroup, string>;
  short: Partial<Record<NavTab, string>>;
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
  more: string;
  mobileNavigation: string;
  allAreas: string;
  allAreasDescription: string;
  skipToContent: string;
};

export const nav: { en: NavStrings; cs: NavStrings } = {
  en: {
    brand: brandConfig.name,
    sections: {
      home: "Home",
      inbox: "Inbox",
      work: "Work overview",
      projects: "Projects",
      opportunities: "Opportunities",
      clients: "Clients",
      career: "Career",
      invoices: "Invoices",
      money: "Money overview",
      accounts: "Accounts",
      transactions: "Transactions",
      subscriptions: "Subscriptions",
      categories: "Categories",
      tasks: "Tasks",
      calendar: "Calendar",
      goals: "Goals",
      dates: "Dates",
      notes: "Notes",
      prompts: "Prompts",
      links: "Links",
      references: "References",
      settings: "Settings",
    },
    groups: { work: "Work", money: "Money", planning: "Planning", library: "Library" },
    short: { opportunities: "Leads", subscriptions: "Subs", transactions: "Tx" },
    theme: "Theme",
    settings: "Settings",
    collapse: "Collapse sidebar",
    expand: "Expand sidebar",
    disconnectGoogle: "Disconnect Google",
    disconnectConfirm: "Disconnect Google? Calendar features will need a re-link.",
    disconnectOk: "Google disconnected.",
    disconnectErr: "Could not disconnect Google.",
    networkErr: "Network error.",
    signOut: "Sign out",
    more: "More",
    mobileNavigation: "Primary navigation",
    allAreas: "All areas",
    allAreasDescription: "Open any visible OwnDashboard destination.",
    skipToContent: "Skip to content",
  },
  cs: {
    brand: brandConfig.name,
    sections: {
      home: "Domů",
      inbox: "Doručené",
      work: "Přehled práce",
      projects: "Projekty",
      opportunities: "Příležitosti",
      clients: "Klienti",
      career: "Kariéra",
      invoices: "Faktury",
      money: "Přehled peněz",
      accounts: "Účty",
      transactions: "Transakce",
      subscriptions: "Předplatná",
      categories: "Kategorie",
      tasks: "Úkoly",
      calendar: "Kalendář",
      goals: "Cíle",
      dates: "Termíny",
      notes: "Poznámky",
      prompts: "Prompty",
      links: "Odkazy",
      references: "Reference",
      settings: "Nastavení",
    },
    groups: { work: "Práce", money: "Peníze", planning: "Plánování", library: "Knihovna" },
    short: { opportunities: "Lead", subscriptions: "Předpl.", transactions: "Trans." },
    theme: "Motiv",
    settings: "Nastavení",
    collapse: "Sbalit panel",
    expand: "Rozbalit panel",
    disconnectGoogle: "Odpojit Google",
    disconnectConfirm: "Odpojit Google? Funkce kalendáře budou vyžadovat opětovné propojení.",
    disconnectOk: "Google odpojen.",
    disconnectErr: "Nepodařilo se odpojit Google.",
    networkErr: "Chyba sítě.",
    signOut: "Odhlásit se",
    more: "Více",
    mobileNavigation: "Hlavní navigace",
    allAreas: "Všechny sekce",
    allAreasDescription: "Otevřete libovolnou viditelnou část OwnDashboardu.",
    skipToContent: "Přejít na obsah",
  },
};
