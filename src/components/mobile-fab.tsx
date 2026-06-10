"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Plus, X } from "lucide-react";
import { useDict } from "@/lib/i18n";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISSED_KEY = "dashboard.installDismissed";

export function MobileFab({ onClick }: { onClick: () => void }) {
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

    function onBefore(e: Event) {
      e.preventDefault();
      if (dismissed) return;
      setInstallEvent(e as BeforeInstallPromptEvent);
      setShowInstall(true);
    }
    window.addEventListener("beforeinstallprompt", onBefore);
    return () => window.removeEventListener("beforeinstallprompt", onBefore);
  }, []);

  async function doInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    setShowInstall(false);
    setInstallEvent(null);
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
      {/* sticky add button — mobile only */}
      <motion.button
        type="button"
        onClick={onClick}
        whileTap={{ scale: 0.92 }}
        aria-label={t.app.quickAdd}
        className="md:hidden fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-elevated flex items-center justify-center focus-ring"
      >
        <Plus className="h-5 w-5" />
      </motion.button>

      {/* install banner — mobile + desktop Chromium */}
      <AnimatePresence>
        {showInstall && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.15 }}
            className="fixed left-4 right-4 md:left-auto md:right-6 md:w-80 bottom-20 md:bottom-6 z-40 rounded-lg border border-border bg-surface shadow-elevated p-3"
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
