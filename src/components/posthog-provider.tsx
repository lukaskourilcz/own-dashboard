"use client";

import { useEffect, type ReactNode } from "react";
import { redactTelemetryText } from "@/lib/telemetry-url";

/** Optional, content-minimized page counts. No session replay, person profiles
 * or automatic interaction capture; SDK failure cannot block the application. */
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
        const allowed = new Set(["token", "distinct_id", "$session_id", "$window_id", "$pageview_id", "$current_url", "$pathname", "$host",
          "$lib", "$lib_version", "$browser", "$browser_version", "$os", "$os_version", "$device_type", "$screen_height", "$screen_width",
          "$viewport_height", "$viewport_width", "$process_person_profile", "$geoip_disable"]);
        posthog.init(KEY, {
          api_host: HOST,
          persistence: "localStorage",
          person_profiles: "never",
          capture_pageview: true,
          capture_pageleave: true,
          autocapture: false,
          disable_session_recording: true,
          advanced_disable_flags: true,
          before_send(event) {
            if (!event || (event.event !== "$pageview" && event.event !== "$pageleave")) return null;
            const properties: Record<string, string | number | boolean | null> = {};
            for (const [key, value] of Object.entries(event.properties)) {
              if (!allowed.has(key)) continue;
              if (typeof value === "string") properties[key] = redactTelemetryText(value);
              else if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) properties[key] = value;
            }
            return { ...event, properties };
          },
        });
      } catch {
        // Optional diagnostics cannot block the application or expose causes.
      }
    })();
    return () => { active = false; };
  }, []);

  return <>{children}</>;
}
