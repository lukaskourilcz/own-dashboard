"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGuardedNavigation } from "@/components/navigation-guard";
import { relinkGoogle } from "@/lib/google-auth";
import { useDict } from "@/lib/i18n";

export function RelinkGoogleButton({
  reason = "calendar-access",
  size = "sm",
}: {
  reason?: "calendar-access" | "expired";
  size?: "sm" | "default";
}) {
  const t = useDict(), navigate = useGuardedNavigation(), errorId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const operation = useRef<AbortController | null>(null), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);

  async function start() {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(false);
    try {
      const result = await relinkGoogle(controller.signal);
      if (result.error) throw Error();
    } catch {
      if (mounted.current && operation.current === controller) { setError(true); setBusy(false); }
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }
  function onClick() {
    if (operation.current) return;
    navigate(() => { void start(); });
  }

  return (
    <div className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <Button onClick={onClick} disabled={busy} aria-busy={busy} aria-describedby={error ? errorId : undefined} size={size} variant="outline">
        <RefreshCw className={"h-3.5 w-3.5" + (busy ? " motion-safe:animate-spin" : "")} />
        {busy
          ? t.common.redirecting
          : reason === "expired"
            ? t.relink.relinkGoogle
            : t.relink.grantCalendarAccess}
      </Button>
      {error && <span id={errorId} role="alert" className="min-w-0 text-xs text-destructive">{t.relink.failed}</span>}
    </div>
  );
}
