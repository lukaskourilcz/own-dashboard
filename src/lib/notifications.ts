import type { AppNotification } from "@/lib/types";
import { safeWebUrl } from "@/lib/web-url";

export function isActionableNotification(
  notification: AppNotification,
  now = new Date(),
): boolean {
  if (notification.read_at || notification.dismissed_at) return false;
  if (!notification.snoozed_until) return true;
  const snoozedUntil = new Date(notification.snoozed_until);
  return Number.isNaN(snoozedUntil.getTime()) || snoozedUntil <= now;
}

export function safeNotificationUrl(value: string | null): string | null {
  if (typeof value !== "string" || value.length > 2000 || /\p{Cc}/u.test(value)) return null;
  const raw = value.trim();
  if (raw.startsWith("/")) {
    if (raw.startsWith("//") || raw.includes("\\")) return null;
    try {
      const origin = "https://own-dashboard.invalid", target = new URL(raw, origin);
      return target.origin === origin && !target.username && !target.password ? raw : null;
    } catch { return null; }
  }
  return safeWebUrl(raw);
}
