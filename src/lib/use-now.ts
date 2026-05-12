"use client";

import { useSyncExternalStore } from "react";

// Module-singleton clock store. Returns null until hydration (server and client
// then render identical markup) and ticks every 30s — enough granularity for
// "Next event in Xm" without spamming re-renders.

let snapshot = 0;
const subscribers = new Set<() => void>();
let timerId: ReturnType<typeof setInterval> | null = null;

function notifyAll(): void {
  for (const cb of subscribers) cb();
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  if (snapshot === 0) {
    snapshot = Date.now();
    queueMicrotask(notifyAll);
  }
  if (!timerId) {
    timerId = setInterval(() => {
      snapshot = Date.now();
      notifyAll();
    }, 30_000);
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  };
}

const getSnapshot = (): number => snapshot;
const getServerSnapshot = (): number => 0;

export function useNow(): Date | null {
  const tick = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return tick === 0 ? null : new Date(tick);
}
