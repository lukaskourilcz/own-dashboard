type AppStrings = {
  quickAdd: string;
  installTitle: string;
  installBody: string;
  install: string;
  notNow: string;
  dismiss: string;
  // Command palette
  commandPalette: string;
  searchPlaceholder: string;
  noMatches: string;
  groupGoTo: string;
  groupActions: string;
  openQuickAdd: string;
  switchToLight: string;
  switchToDark: string;
  switchToEnglish: string;
  switchToCzech: string;
  // Not-found (wrong URL) page.
  notFoundTitle: string;
  notFoundBody: string;
  notFoundHome: string;
  notFoundLogin: string;
};

export const app: { en: AppStrings; cs: AppStrings } = {
  en: {
    quickAdd: "Quick add",
    installTitle: "Install Dashboard",
    installBody: "Add to your home screen for one-tap access.",
    install: "Install",
    notNow: "Not now",
    dismiss: "Dismiss",
    commandPalette: "Command palette",
    searchPlaceholder: "Type a command or search…",
    noMatches: "No matches.",
    groupGoTo: "Go to",
    groupActions: "Actions",
    openQuickAdd: "Open quick-add",
    switchToLight: "Switch to light mode",
    switchToDark: "Switch to dark mode",
    switchToEnglish: "Switch to English",
    switchToCzech: "Přepnout do češtiny",
    notFoundTitle: "Wrong URL",
    notFoundBody:
      "That address doesn’t exist. You may have mistyped it — let’s get you back on track.",
    notFoundHome: "Go to homepage",
    notFoundLogin: "Sign in",
  },
  cs: {
    quickAdd: "Rychlé přidání",
    installTitle: "Nainstalovat Dashboard",
    installBody: "Přidejte na plochu pro přístup jedním klepnutím.",
    install: "Nainstalovat",
    notNow: "Teď ne",
    dismiss: "Zavřít",
    commandPalette: "Příkazová paleta",
    searchPlaceholder: "Zadejte příkaz nebo hledejte…",
    noMatches: "Žádné výsledky.",
    groupGoTo: "Přejít na",
    groupActions: "Akce",
    openQuickAdd: "Otevřít rychlé přidání",
    switchToLight: "Přepnout na světlý režim",
    switchToDark: "Přepnout na tmavý režim",
    switchToEnglish: "Switch to English",
    switchToCzech: "Přepnout do češtiny",
    notFoundTitle: "Špatná adresa",
    notFoundBody:
      "Tahle adresa neexistuje. Nejspíš došlo k překlepu — pojďme tě vrátit zpět.",
    notFoundHome: "Přejít na úvodní stránku",
    notFoundLogin: "Přihlásit se",
  },
};
