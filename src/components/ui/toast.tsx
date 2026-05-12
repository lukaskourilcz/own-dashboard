"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "ok" | "err" | "info";

type ToastInput = { tone?: ToastTone; message: string; duration?: number };

type ToastRecord = {
  id: number;
  tone: ToastTone;
  message: string;
};

type ToastApi = {
  push: (input: ToastInput) => void;
  ok: (message: string) => void;
  err: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/60 dark:text-emerald-200",
  err: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/60 dark:text-red-200",
  info: "border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200",
};

const TONE_ICON: Record<ToastTone, typeof CheckCircle2> = {
  ok: CheckCircle2,
  err: AlertCircle,
  info: Info,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const push = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    const tone = input.tone ?? "info";
    setToasts((prev) => [...prev, { id, tone, message: input.message }]);
    const duration = input.duration ?? 3500;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      ok: (message) => push({ tone: "ok", message }),
      err: (message) => push({ tone: "err", message }),
      info: (message) => push({ tone: "info", message }),
    }),
    [push],
  );

  const dismiss = (id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone];
          return (
            <div
              key={t.id}
              className={cn(
                "pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-md min-w-[14rem] max-w-sm",
                TONE_STYLES[t.tone],
              )}
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="flex-1">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
