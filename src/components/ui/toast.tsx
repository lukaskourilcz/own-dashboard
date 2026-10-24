"use client";

import { Toaster, toast } from "sonner";
import { useDict } from "@/lib/i18n";
import { useTheme } from "@/lib/use-theme";

type ToastApi = {
  ok: (message: string) => void;
  err: (message: string) => void;
  info: (message: string) => void;
};

const api: ToastApi = {
  ok: (message) => toast.success(message),
  err: (message) => toast.error(message),
  info: (message) => toast(message),
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const t = useDict().common;
  return (
    <>
      {children}
      <Toaster
        theme={theme}
        position="bottom-right"
        // The app's bottom bar remains through 767px; Sonner's own mobile
        // breakpoint ends at 600px. Use our clearance at both library sizes.
        className="[--toast-clearance:calc(4.5rem+env(safe-area-inset-bottom,0px))] md:[--toast-clearance:1.5rem]"
        offset={{ bottom: "var(--toast-clearance)" }}
        mobileOffset={{ bottom: "var(--toast-clearance)" }}
        containerAriaLabel={t.notifications}
        toastOptions={{
          className: "!font-sans !pr-14 md:!pr-12",
          classNames: { closeButton: "!left-auto !right-1 !top-1 !size-11 !transform-none !border-0 !bg-transparent !text-foreground hover:!bg-surface-hover md:!size-8 [&_svg]:!size-4" },
          closeButtonAriaLabel: t.closeNotification,
          style: {
            background: "var(--surface)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-lg)",
            borderRadius: "var(--radius)",
            fontSize: "13px",
          },
        }}
        closeButton
        richColors
      />
    </>
  );
}

export function useToast(): ToastApi {
  return api;
}
