"use client";

/** One storage listener per observed store. Read the current value when an
 * event arrives: queued events may describe an already superseded write.
 * This never persists a value or sends a server request. */
type Observer = { handler?: (event: StorageEvent) => void; value?: string | null };
const observers = new WeakMap<Set<() => void>, Observer>();
function storedValue(key: string): { value: string | null } | null {
  try { return { value: localStorage.getItem(key) }; } catch { return null; }
}
export function subscribeStoredPreference(key: string, listeners: Set<() => void>, callback: () => void, onExternalChange: () => void): () => void {
  listeners.add(callback);
  let record = observers.get(listeners);
  if (!record?.handler) {
    const resumed = record !== undefined;
    record ??= {};
    const observer = record;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== key) return;
      try { if (event.storageArea && event.storageArea !== window.localStorage) return; } catch { return; }
      const latest = storedValue(key); if (latest) observer.value = latest.value;
      onExternalChange();
      for (const listener of listeners) listener();
    };
    observer.handler = onStorage; observers.set(listeners, observer); window.addEventListener("storage", onStorage);
    // A different tab may write between the first render and subscription, or
    // while this store has no mounted consumers. Attach before reconciling.
    const latest = storedValue(key);
    if (latest) {
      // Missing initial keys already have the bootstrap/store's fallback.
      // Reconcile explicit values without overriding an in-memory fallback.
      const changed = resumed ? latest.value !== observer.value : latest.value !== null;
      observer.value = latest.value;
      if (changed) { onExternalChange(); for (const listener of listeners) listener(); }
    }
  }
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      const observer = observers.get(listeners);
      if (observer?.handler) {
        window.removeEventListener("storage", observer.handler); observer.handler = undefined;
        const latest = storedValue(key); if (latest) observer.value = latest.value;
      }
    }
  };
}
