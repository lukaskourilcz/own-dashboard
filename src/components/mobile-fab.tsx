"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDict } from "@/lib/i18n";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISSED_KEY = "dashboard.installDismissed";

export function MobileFab() {
  const t = useDict();
  const installEvent = useRef<BeforeInstallPromptEvent | null>(null);
  const dismissed = useRef(false);
  const installed = useRef(false);
  const prompting = useRef(false);
  const [showInstall, setShowInstall] = useState(false);

  // Capture Chrome/Edge install prompt. iOS doesn't fire this — the iOS sheet
  // is the user's responsibility (Safari > Share > Add to Home Screen).
  useEffect(() => {
    try { dismissed.current = window.localStorage.getItem(INSTALL_DISMISSED_KEY) === "1"; }
    catch { /* Session-local dismissal still works when storage is blocked. */ }
    installed.current = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as { standalone?: boolean }).standalone === true;

    function onBefore(e: Event) {
      e.preventDefault();
      if (dismissed.current || installed.current || prompting.current) return;
      installEvent.current = e as BeforeInstallPromptEvent;
      setShowInstall(true);
    }

    // Once installed, hide the banner and don't resurface it. Accepting the
    // prompt hands the app to its own window (the browser reparents this tab —
    // expected behaviour); this just keeps our UI in sync.
    function onInstalled() {
      installed.current = true;
      setShowInstall(false);
      installEvent.current = null;
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
      installEvent.current = null;
    };
  }, []);

  async function doInstall() {
    const event = installEvent.current;
    if (!event || prompting.current) return;
    // Consume the single-use event before React commits or the browser waits.
    installEvent.current = null;
    prompting.current = true;
    setShowInstall(false);
    try {
      await event.prompt();
      await event.userChoice;
    } catch {
      // Native refusal leaves this event consumed. A fresh event can offer again.
    } finally {
      prompting.current = false;
    }
  }

  function dismissInstall() {
    dismissed.current = true;
    setShowInstall(false);
    installEvent.current = null;
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
            role="region" aria-label={t.app.installTitle}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-36 left-4 right-4 z-40 rounded-lg border border-border bg-surface p-3 shadow-elevated md:bottom-6 md:left-auto md:right-6 md:w-80"
          >
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                <Download aria-hidden className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t.app.installTitle}</p>
                <p className="text-xs text-foreground-muted mt-0.5">
                  {t.app.installBody}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={doInstall}
                  >
                    {t.app.install}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={dismissInstall}
                  >
                    {t.app.notNow}
                  </Button>
                </div>
              </div>
              <Button
                variant="ghost" size="icon"
                type="button"
                onClick={dismissInstall}
                aria-label={t.app.dismiss}
                className="shrink-0"
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
