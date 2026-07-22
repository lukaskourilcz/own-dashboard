"use client";

import { Circle } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { statusLabel, statusTone, type StatusTone } from "@/lib/status-presentation";
import { cn } from "@/lib/utils";

const tones: Record<StatusTone, string> = {
  neutral: "border-border-strong bg-surface-secondary text-foreground-muted",
  information: "border-information/25 bg-information-soft text-information",
  success: "border-success/25 bg-success-soft text-success",
  warning: "border-warning/25 bg-warning-soft text-warning",
  risk: "border-risk/25 bg-risk-soft text-risk",
  destructive: "border-destructive/25 bg-destructive-soft text-destructive",
};

export function StatusBadge({ value, label, tone, className }: { value: string; label?: string; tone?: StatusTone; className?: string }) {
  const { lang } = useLang();
  const resolved = tone ?? statusTone(value);
  return (
    <span className={cn("inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4", tones[resolved], className)}>
      <Circle className="h-1.5 w-1.5 fill-current" aria-hidden />
      <span>{label ?? statusLabel(value, lang)}</span>
    </span>
  );
}

export function EntityBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex min-h-6 items-center rounded-sm border border-border bg-surface-inset px-2 py-0.5 text-[11px] text-foreground-muted", className)}>{children}</span>;
}
