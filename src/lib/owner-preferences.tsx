"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { subscribeStoredPreference } from "@/lib/preference-storage";

type PrivateValues = { cv_url_cs: string; cv_url_en: string; show_czech_career: boolean };
type PrivateField = keyof PrivateValues;
type StoredDraft = { value: string; dirty: boolean };

/** Private drafts belong to one authenticated owner. Legacy unowned keys are
 * deliberately not adopted: their author cannot be established. */
function privatePreference(ownerId: string, field: PrivateField, initial?: string) {
  const key = `owner-preference:${encodeURIComponent(ownerId)}:${field}`;
  const listeners = new Set<() => void>();
  let value = initial ?? "", dirty = false, loaded = false, lastRaw: string | null = null;
  function rawValue() { try { return localStorage.getItem(key); } catch { return null; } }
  function readStored(raw: string | null): StoredDraft | null {
    try {
      if (!raw || raw.length > 10_000) return null;
      const item: unknown = JSON.parse(raw);
      if (!item || typeof item !== "object" || !("value" in item) || !("dirty" in item)
        || typeof item.value !== "string" || item.value.length > 2000 || typeof item.dirty !== "boolean") return null;
      return { value: item.value, dirty: item.dirty };
    } catch { return null; }
  }
  function load() {
    if (loaded || typeof window === "undefined") return;
    loaded = true;
    lastRaw = rawValue();
    const stored = readStored(lastRaw);
    if (stored && (stored.dirty || initial === undefined)) ({ value, dirty } = stored);
  }
  function persist() {
    try { localStorage.setItem(key, JSON.stringify({ value, dirty })); lastRaw = rawValue(); } catch { /* Retain this owner's memory draft. */ }
  }
  function notify() { for (const listener of listeners) listener(); }
  return {
    read: () => { load(); return value; },
    isDirty: () => { load(); return dirty; },
    serverRead: () => initial ?? "",
    set: (next: string) => { load(); value = next; dirty = true; persist(); notify(); },
    hydrate: (next: string) => { load(); if (dirty) return; value = next; persist(); notify(); },
    confirm: (next: string) => { load(); if (value !== next) return; dirty = false; persist(); },
    subscribe: (listener: () => void) => subscribeStoredPreference(key, listeners, listener, () => {
      // Read current storage, not the possibly stale StorageEvent payload.
      const raw = rawValue();
      if (raw === lastRaw) return;
      lastRaw = raw;
      const stored = readStored(raw);
      if (stored) ({ value, dirty } = stored);
      else if (!dirty) value = initial ?? "";
    }),
  };
}

function createPrivatePreferences(ownerId: string, initial?: PrivateValues) {
  const cvCs = privatePreference(ownerId, "cv_url_cs", initial?.cv_url_cs);
  const cvEn = privatePreference(ownerId, "cv_url_en", initial?.cv_url_en);
  const czechCareer = privatePreference(ownerId, "show_czech_career", initial ? (initial.show_czech_career ? "1" : "0") : undefined);
  let controller = new AbortController();
  return { ownerId, cvCs, cvEn, czechCareer,
    capture: () => ({ ownerId, signal: controller.signal }),
    resume: () => { if (controller.signal.aborted) controller = new AbortController(); },
    dispose: () => controller.abort(),
    hydrate: (values: PrivateValues) => { cvCs.hydrate(values.cv_url_cs); cvEn.hydrate(values.cv_url_en); czechCareer.hydrate(values.show_czech_career ? "1" : "0"); },
    confirm: (patch: Record<string, unknown>) => {
      if (typeof patch.cv_url_cs === "string") cvCs.confirm(patch.cv_url_cs);
      if (typeof patch.cv_url_en === "string") cvEn.confirm(patch.cv_url_en);
      if (typeof patch.show_czech_career === "boolean") czechCareer.confirm(patch.show_czech_career ? "1" : "0");
    },
  };
}
const Context = createContext<ReturnType<typeof createPrivatePreferences> | null>(null);
function OwnerPreferencesScope({ ownerId, initial, children }: { ownerId: string; initial?: PrivateValues; children: ReactNode }) {
  const [preferences] = useState(() => createPrivatePreferences(ownerId, initial));
  useEffect(() => { preferences.resume(); return () => preferences.dispose(); }, [preferences]);
  return <Context.Provider value={preferences}>{children}</Context.Provider>;
}
export function OwnerPreferencesProvider(props: { ownerId: string; initial?: PrivateValues; children: ReactNode }) {
  return <OwnerPreferencesScope key={props.ownerId} {...props} />;
}
export const useOwnerPreferences = () => useContext(Context);

/** Outside an owner scope, private fields fail closed without touching storage. */
export const unavailablePrivatePreference = Object.freeze({ read: () => "", serverRead: () => "", set: () => {}, subscribe: () => () => {} });
