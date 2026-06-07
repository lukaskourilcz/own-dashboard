"use client";

import { Toaster, toast } from "sonner";
import { useTheme } from "@/lib/use-theme";

export type ToastTone = "ok" | "err" | "info";

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
  return (
    <>
      {children}
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{
          className: "!font-sans",
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
