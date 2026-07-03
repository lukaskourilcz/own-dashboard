"use client";

import { useEffect, type ReactNode } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

/**
 * PostHog analytics + feature flags + session replay. Entirely opt-in: with no
 * NEXT_PUBLIC_POSTHOG_KEY it renders children untouched and never loads the SDK,
 * so installs without PostHog pay zero cost (same pattern as Sentry here).
 *
 * Privacy-first defaults for a personal, EU-hosted app: no cookies
 * (localStorage persistence, so no cookie banner needed), identified-only
 * person profiles, and session replay that masks every input and all text.
 */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!KEY || posthog.__loaded) return;
    posthog.init(KEY, {
      api_host: HOST,
      persistence: "localStorage", // cookieless — GDPR-friendly, no banner
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "*",
      },
    });
  }, []);

  // Without a key we never mount the provider — children render exactly as
  // before, and useFeatureFlag() falls back to its default-on behaviour.
  if (!KEY) return <>{children}</>;
  return <PHProvider client={posthog}>{children}</PHProvider>;
}
