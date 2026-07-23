"use client";

import { useEffect, useRef } from "react";
import { useLang } from "@/lib/i18n";
import {
  useCvLinks,
  useDisplayCurrency,
  useNavCollapsed,
  useNavOrder,
  useNavVisibility,
  useTasksPerCategory,
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
  const { setCs, setEn } = useCvLinks();
  const { setLayout } = useDashboardLayout();

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    setLang(preferences.language);
    setTheme(preferences.theme);
    setCurrency(preferences.display_currency);
    setHidden(preferences.hidden_navigation);
    setOrder(preferences.navigation_order);
    setCollapsed(preferences.navigation_collapsed);
    setLayout(normalizeLayout(preferences.dashboard_layout));
    setCount(preferences.tasks_per_category);
    setCs(preferences.cv_url_cs);
    setEn(preferences.cv_url_en);
  }, [
    preferences,
    setCollapsed,
    setCount,
    setCs,
    setCurrency,
    setEn,
    setHidden,
    setLang,
    setLayout,
    setOrder,
    setTheme,
  ]);

  return null;
}
