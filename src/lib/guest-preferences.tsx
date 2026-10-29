"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type StringPreference = { read: () => string; set: (value: string) => void; subscribe: (listener: () => void) => () => void };
function memoryPreference(): StringPreference {
  let value = ""; const listeners = new Set<() => void>();
  return { read: () => value, set: next => { if (next === value) return; value = next; for (const listener of listeners) listener(); },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
type GuestPreferences = { cvCs: StringPreference; cvEn: StringPreference; czechCareer: StringPreference };
const Context = createContext<GuestPreferences | null>(null);

/** Tour settings share only their own in-memory values. Context is available
 * on the first render, before effects or a guest marker can run; owner caches
 * and browser storage never supply these personal fields. */
export function GuestPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences] = useState<GuestPreferences>(() => ({ cvCs: memoryPreference(), cvEn: memoryPreference(), czechCareer: memoryPreference() }));
  return <Context.Provider value={preferences}>{children}</Context.Provider>;
}
export const useGuestPreferences = () => useContext(Context);
