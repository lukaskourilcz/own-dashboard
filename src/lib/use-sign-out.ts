"use client";
import { useCallback, useState } from "react";
import { useGuardedNavigation } from "@/components/navigation-guard";
import { guestReadOnlyError, isGuestTour } from "@/lib/guest-requests";
import { requestSignOut } from "@/lib/auth-actions";
import { useDict } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

export function useSignOut() {
  const [pending, setPending] = useState(false);
  const t = useDict(), toast = useToast();
  const guard = useGuardedNavigation();
  const perform = useCallback(async () => {
    setPending(true);
    try {
      await requestSignOut();
      // Cross the auth boundary with a new document to release owner query/editor state.
      window.location.replace(new URL("/login", window.location.origin).href);
    }
    catch { setPending(false); if (!isGuestTour()) toast.err(t.nav.signOutFailed); }
  }, [t.nav.signOutFailed, toast]);
  const run = useCallback(() => {
    if (isGuestTour()) { guestReadOnlyError(); return; }
    guard(() => { void perform(); });
  }, [guard, perform]);
  return { pending, run };
}
