type SettingsStrings = {
  title: string;
  description: string;
  language: string;
  languageDesc: string;
  english: string;
  czech: string;
  currency: string;
  currencyDesc: string;
  appearance: string;
  appearanceDesc: string;
  light: string;
  dark: string;
  navigation: string;
  navigationDesc: string;
  alwaysVisible: string;
  tasks: string;
  tasksDesc: string;
  tasksAll: string;
};

export const settings: { en: SettingsStrings; cs: SettingsStrings } = {
  en: {
    title: "Settings",
    description: "Personalize your dashboard.",
    language: "Language",
    languageDesc: "Choose the language for the whole app.",
    english: "English",
    czech: "Čeština",
    currency: "Display currency",
    currencyDesc: "All totals and charts are converted into this currency.",
    appearance: "Appearance",
    appearanceDesc: "Switch between light and dark mode.",
    light: "Light",
    dark: "Dark",
    navigation: "Navigation sections",
    navigationDesc:
      "Choose which sections appear in the navigation panel. Overview is always shown.",
    alwaysVisible: "Always visible",
    tasks: "Tasks",
    tasksDesc:
      "How many tasks each category shows before “show all”.",
    tasksAll: "All",
  },
  cs: {
    title: "Nastavení",
    description: "Přizpůsobte si svůj přehled.",
    language: "Jazyk",
    languageDesc: "Vyberte jazyk pro celou aplikaci.",
    english: "English",
    czech: "Čeština",
    currency: "Zobrazená měna",
    currencyDesc: "Všechny součty a grafy se převádějí do této měny.",
    appearance: "Vzhled",
    appearanceDesc: "Přepínejte mezi světlým a tmavým režimem.",
    light: "Světlý",
    dark: "Tmavý",
    navigation: "Sekce navigace",
    navigationDesc:
      "Vyberte, které sekce se zobrazí v navigačním panelu. Přehled je vždy zobrazen.",
    alwaysVisible: "Vždy viditelné",
    tasks: "Úkoly",
    tasksDesc: "Kolik úkolů každá kategorie zobrazí před „zobrazit vše“.",
    tasksAll: "Vše",
  },
};
