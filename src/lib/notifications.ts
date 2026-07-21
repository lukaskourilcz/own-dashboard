import type { AppNotification } from "@/lib/types";

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
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
