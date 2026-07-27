"use client";

import { useEffect } from "react";
import { useLang, type Lang } from "@/lib/i18n";

/**
 * Applies `/guest?lang=` to the language store.
 *
 * `/guest` renders with `isPreview`, so `PreferenceHydrator` never mounts and
 * `initialPreferences.language` has nothing to apply it. `useLang` reads the
 * `<html lang>` attribute, so the query parameter has to go through `setLang`
 * to reach the dictionary.
 */
export function GuestLocale({ lang }: { lang: Lang }) {
  const { lang: current, setLang } = useLang();

  useEffect(() => {
    if (current !== lang) setLang(lang);
  }, [current, lang, setLang]);

  return null;
}
