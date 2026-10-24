"use client";

/** One storage listener per observed store. Read the current value when an
 * event arrives: queued events may describe an already superseded write.
 * This never persists a value or sends a server request. */
const observers = new WeakMap<Set<() => void>, (event: StorageEvent) => void>();
export function subscribeStoredPreference(key: string, listeners: Set<() => void>, callback: () => void, onExternalChange: () => void): () => void {
  listeners.add(callback);
  if (!observers.has(listeners)) {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== key) return;
      try { if (event.storageArea && event.storageArea !== window.localStorage) return; } catch { return; }
      onExternalChange();
      for (const listener of listeners) listener();
    };
    observers.set(listeners, onStorage); window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      const observer = observers.get(listeners); if (observer) window.removeEventListener("storage", observer);
      observers.delete(listeners);
    }
  };
}
