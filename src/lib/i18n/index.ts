"use client";

import { cs as csLocale, enUS } from "date-fns/locale";
import type { Locale } from "date-fns";
import { useLang, type Lang } from "./lang";
import { common } from "./sections/common";
import { nav } from "./sections/nav";
import { settings } from "./sections/settings";
import { dashboard } from "./sections/dashboard";
import { overview } from "./sections/overview";
import { kpi } from "./sections/kpi";
import { login } from "./sections/login";
import { app } from "./sections/app";
import { relink } from "./sections/relink";
import { subscriptions } from "./sections/subscriptions";
import { finances } from "./sections/finances";
import { invoices } from "./sections/invoices";
import { todos } from "./sections/todos";
import { plans } from "./sections/plans";
import { notes } from "./sections/notes";
import { prompts } from "./sections/prompts";
import { shortcuts } from "./sections/shortcuts";
import { dates } from "./sections/dates";
import { calendar } from "./sections/calendar";
import { github } from "./sections/github";
import { guest } from "./sections/guest";
import { projects } from "./sections/projects";
import { ai } from "./sections/ai";
import { costs } from "./sections/costs";
import { jobs } from "./sections/jobs";
import { categories } from "./sections/categories";
import { professional } from "./sections/professional";

export { useLang, DEFAULT_LANG, LANGS, type Lang } from "./lang";

export const dictionaries = {
  en: {
    common: common.en,
    nav: nav.en,
    settings: settings.en,
    dashboard: dashboard.en,
    overview: overview.en,
    kpi: kpi.en,
    login: login.en,
    app: app.en,
    relink: relink.en,
    subscriptions: subscriptions.en,
    finances: finances.en,
    invoices: invoices.en,
    todos: todos.en,
    plans: plans.en,
    notes: notes.en,
    prompts: prompts.en,
    shortcuts: shortcuts.en,
    dates: dates.en,
    calendar: calendar.en,
    github: github.en,
    guest: guest.en,
    projects: projects.en,
    ai: ai.en,
    costs: costs.en,
    jobs: jobs.en,
    categories: categories.en,
    professional: professional.en,
  },
  cs: {
    common: common.cs,
    nav: nav.cs,
    settings: settings.cs,
    dashboard: dashboard.cs,
    overview: overview.cs,
    kpi: kpi.cs,
    login: login.cs,
    app: app.cs,
    relink: relink.cs,
    subscriptions: subscriptions.cs,
    finances: finances.cs,
    invoices: invoices.cs,
    todos: todos.cs,
    plans: plans.cs,
    notes: notes.cs,
    prompts: prompts.cs,
    shortcuts: shortcuts.cs,
    dates: dates.cs,
    calendar: calendar.cs,
    github: github.cs,
    guest: guest.cs,
    projects: projects.cs,
    ai: ai.cs,
    costs: costs.cs,
    jobs: jobs.cs,
    categories: categories.cs,
    professional: professional.cs,
  },
};

export type Dict = (typeof dictionaries)["en"];

/** Translations for the active language. Access as `t.section.key`. */
export function useDict(): Dict {
  const { lang } = useLang();
  return dictionaries[lang];
}

export function dateLocale(lang: Lang): Locale {
  return lang === "cs" ? csLocale : enUS;
}

/** date-fns locale object for the active language. */
export function useDateLocale(): Locale {
  const { lang } = useLang();
  return dateLocale(lang);
}
