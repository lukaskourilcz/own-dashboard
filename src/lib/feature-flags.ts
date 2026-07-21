"use client";

import { useFeatureFlagEnabled } from "posthog-js/react";

/**
 * Read a PostHog feature flag, defaulting to `defaultValue` (on) when the flag
 * is unresolved or PostHog isn't configured. This lets new surfaces ship
 * enabled by default while still being remotely killable: set the flag to
 * `false` in PostHog to hide the surface for a gradual/safe rollout.
 */
export function useFeatureFlag(key: string, defaultValue = true): boolean {
  const enabled = useFeatureFlagEnabled(key);
  return enabled ?? defaultValue;
}

/** Flag keys used across the app — keep names in one place. */
export const FLAGS = {
  costsFilter: "costs-filter",
} as const;
