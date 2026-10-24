"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useDict } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Marks `/guest` as a demo. It floats over the bottom of the app window rather
 * than displacing anything, so the window chrome stays exactly as an owner sees
 * it — the tour shows the real product, and the strip explains the data.
 *
 * Fixed rather than in flow because `.mac-desktop` is a 100vh `overflow:
 * hidden` container on desktop; anything added to the flow would push the
 * window out of view. The 20 px graphite margin is too thin to hold the strip,
 * so it is offset past that margin and overlays the window instead.
 */
export function GuestBanner({ className }: { className?: string }) {
  const t = useDict();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-50 flex justify-center px-3",
        "md:bottom-[calc(var(--desktop-padding-block)+0.75rem)]",
        className,
      )}
    >
      <div
        role="status"
        className="pointer-events-auto flex max-w-[min(100%,34rem)] items-center gap-2 rounded-lg border border-border bg-surface/95 py-2 pl-3 pr-1.5 text-[12px] shadow-elevated backdrop-blur-md"
      >
        <div className="min-w-0 flex-1">
          <span className="inline-flex max-w-full rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">{t.guest.label}</span>
          <p className="mt-0.5 text-foreground-muted">{t.guest.description}</p>
        </div>
        <Link
          href="/login"
          prefetch={false}
          className="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-md px-2 py-1 font-medium md:min-h-8 text-foreground underline-offset-2 hover:underline"
        >
          {t.guest.signIn}
        </Link>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label={t.guest.dismiss}
          className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-md text-foreground-muted hover:bg-surface-hover md:h-8 md:w-8 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
