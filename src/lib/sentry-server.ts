import "server-only";

/** Only a fixed diagnostic code and HTTP status can enter this call. */
export async function captureCalendarRejection(method: "POST" | "DELETE", status: number): Promise<void> {
  if (!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)) return;
  try {
    const sentry = await import("@sentry/nextjs");
    sentry.captureMessage(`calendar.event.${method} upstream rejected`, { level: "error", extra: { status } });
  } catch { /* Optional diagnostics cannot break a Calendar response. */ }
}
