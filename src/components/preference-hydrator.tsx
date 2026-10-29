"use client";

import { useEffect, useRef } from "react";
import { useOwnerPreferences } from "@/lib/owner-preferences";
import { useLang } from "@/lib/i18n";
import {
  useDisplayCurrency,
  useNavCollapsed,
  useNavOrder,
  useNavVisibility,
  useTasksPerCategory,
  useProjectTabVisibility,
} from "@/lib/use-prefs";
import { useTheme } from "@/lib/use-theme";
import { useDashboardLayout } from "@/lib/use-dashboard-layout";
import { normalizeLayout } from "@/lib/dashboard-layout";

export type SyncedUiPreferences = {
  language: "cs" | "en";
  theme: "light" | "dark";
  display_currency: string;
  hidden_navigation: string[];
  navigation_order: string[];
  navigation_collapsed: boolean;
  dashboard_layout: string[];
  tasks_per_category: number;
  cv_url_cs: string;
  cv_url_en: string;
  hidden_project_tabs: string[];
  show_czech_career?: boolean;
  sync_available: boolean;
};

export function PreferenceHydrator({
  preferences,
}: {
  preferences: SyncedUiPreferences;
}) {
  const hydrated = useRef(false);
  const { setLang } = useLang();
  const { setTheme } = useTheme();
  const { setCurrency } = useDisplayCurrency();
  const { setHidden } = useNavVisibility();
  const { setOrder } = useNavOrder();
  const { setCollapsed } = useNavCollapsed();
  const { setCount } = useTasksPerCategory();
  const ownerPreferences = useOwnerPreferences();
  const { setLayout } = useDashboardLayout();
  const { setHiddenProjectTabs } = useProjectTabVisibility();

  useEffect(() => {
    if (hydrated.current) return;
    if (!preferences.sync_available) return;
    hydrated.current = true;
    setLang(preferences.language);
    setTheme(preferences.theme);
    setCurrency(preferences.display_currency);
    setHidden(preferences.hidden_navigation);
    setOrder(preferences.navigation_order);
    setCollapsed(preferences.navigation_collapsed);
    setLayout(normalizeLayout(preferences.dashboard_layout));
    setCount(preferences.tasks_per_category);
    ownerPreferences?.hydrate({ cv_url_cs: preferences.cv_url_cs, cv_url_en: preferences.cv_url_en, show_czech_career: preferences.show_czech_career === true });
    setHiddenProjectTabs(preferences.hidden_project_tabs);
  }, [
    preferences,
    setCollapsed,
    setCount,
    setCurrency,
    setHidden,
    setLang,
    setLayout,
    setOrder,
    setTheme,
    setHiddenProjectTabs,
    ownerPreferences,
  ]);

  return null;
}
