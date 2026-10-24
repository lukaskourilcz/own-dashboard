"use client";

import { useEffect, type ReactNode } from "react";

/** Optional analytics: load the SDK only when configured. Existing configured
 * capture uses localStorage, identified-only profiles and masked replay text.
 * Those settings describe collection behavior, not legal consent compliance. */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!KEY) return;
    let active = true;
    void (async () => {
      try {
        const { default: posthog } = await import("posthog-js");
        if (!active || posthog.__loaded) return;
        posthog.init(KEY, {
          api_host: HOST,
          persistence: "localStorage",
          person_profiles: "identified_only",
          capture_pageview: true,
          capture_pageleave: true,
          autocapture: true,
          disable_session_recording: false,
          session_recording: { maskAllInputs: true, maskTextSelector: "*" },
        });
      } catch {
        // Optional diagnostics cannot block the application or expose causes.
      }
    })();
    return () => { active = false; };
  }, []);

  return <>{children}</>;
}
