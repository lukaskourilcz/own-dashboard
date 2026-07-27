"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useDict } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Marks `/guest` as a demo. It sits on the graphite desktop rather than inside
 * the app window, so the 1360 px window chrome stays exactly as an owner sees
 * it — the tour shows the real product, and the strip explains the data.
 *
 * Fixed rather than in flow because `.mac-desktop` is a 100vh `overflow:
 * hidden` container on desktop; anything added to the flow would push the
 * window out of view.
 */
export function GuestBanner({ className }: { className?: string }) {
  const t = useDict();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-3 z-50 flex justify-center px-3",
        "md:bottom-[calc(var(--desktop-padding)/3)]",
        className,
      )}
    >
      <div
        role="status"
        className="pointer-events-auto flex max-w-[min(100%,34rem)] items-center gap-2 rounded-full border border-border bg-surface/95 py-1.5 pl-3 pr-1.5 text-[12px] shadow-elevated backdrop-blur-md"
      >
        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
          {t.guest.label}
        </span>
        <span className="min-w-0 truncate text-muted-foreground">{t.guest.description}</span>
        <Link
          href="/login"
          className="focus-ring shrink-0 rounded-full px-2 py-1 font-medium text-foreground underline-offset-2 hover:underline"
        >
          {t.guest.signIn}
        </Link>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label={t.guest.dismiss}
          className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
