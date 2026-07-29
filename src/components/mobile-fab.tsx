"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Download, X } from "lucide-react";
import { useDict } from "@/lib/i18n";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISSED_KEY = "dashboard.installDismissed";

export function MobileFab() {
  const t = useDict();
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  // Capture Chrome/Edge install prompt. iOS doesn't fire this — the iOS sheet
  // is the user's responsibility (Safari > Share > Add to Home Screen).
  useEffect(() => {
    const dismissed =
      typeof window !== "undefined" &&
      window.localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";

    // Already running as an installed app — never offer to install again.
    const installed =
      typeof window !== "undefined" &&
      (window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari exposes standalone here instead of via matchMedia.
        (window.navigator as { standalone?: boolean }).standalone === true);

    function onBefore(e: Event) {
      e.preventDefault();
      if (dismissed || installed) return;
      setInstallEvent(e as BeforeInstallPromptEvent);
      setShowInstall(true);
    }

    // Once installed, hide the banner and don't resurface it. Accepting the
    // prompt hands the app to its own window (the browser reparents this tab —
    // expected behaviour); this just keeps our UI in sync.
    function onInstalled() {
      setShowInstall(false);
      setInstallEvent(null);
      try {
        window.localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
      } catch {
        // Private mode / storage disabled — ignore.
      }
    }

    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function doInstall() {
    if (!installEvent) return;
    // Hide our banner first so only the browser's native dialog remains.
    setShowInstall(false);
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } catch {
      // The event can only be used once; ignore replays / gesture errors.
    } finally {
      // A prompt is single-use — drop it either way. `appinstalled` handles the
      // accepted case; a dismissal simply leaves the FAB with no banner.
      setInstallEvent(null);
    }
  }

  function dismissInstall() {
    setShowInstall(false);
    setInstallEvent(null);
    try {
      window.localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      // Private mode / storage disabled — ignore.
    }
  }

  return (
    <>
      {/* install banner — mobile + desktop Chromium */}
      <AnimatePresence>
        {showInstall && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-36 left-4 right-4 z-40 rounded-lg border border-border bg-surface p-3 shadow-elevated md:bottom-6 md:left-auto md:right-6 md:w-80"
          >
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                <Download className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t.app.installTitle}</p>
                <p className="text-xs text-foreground-muted mt-0.5">
                  {t.app.installBody}
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={doInstall}
                    className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    {t.app.install}
                  </button>
                  <button
                    type="button"
                    onClick={dismissInstall}
                    className="text-xs text-foreground-subtle hover:text-foreground"
                  >
                    {t.app.notNow}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={dismissInstall}
                aria-label={t.app.dismiss}
                className="text-foreground-subtle hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
