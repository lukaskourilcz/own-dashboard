"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { relinkGoogle } from "@/lib/google-auth";

export function RelinkGoogleButton({
  reason = "calendar-access",
  size = "sm",
}: {
  reason?: "calendar-access" | "expired";
  size?: "sm" | "default";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    const { error } = await relinkGoogle();
    if (error) {
      setError(error);
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Button onClick={onClick} disabled={busy} size={size} variant="outline">
        <RefreshCw className={"h-3.5 w-3.5" + (busy ? " animate-spin" : "")} />
        {busy
          ? "Redirecting…"
          : reason === "expired"
            ? "Re-link Google"
            : "Grant Calendar access"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
