import type { Instrumentation } from "next";

export async function register() {
  if (!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)) return;
  try {
    if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
    if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
  } catch { /* Optional diagnostics cannot prevent the server from starting. */ }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)) return;
  try { await (await import("@sentry/nextjs")).captureRequestError(...args); }
  catch { /* Preserve the original application error. */ }
};
