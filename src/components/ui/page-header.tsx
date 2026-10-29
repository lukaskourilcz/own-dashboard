"use client";

import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";

const ShellTitleContext = createContext(false);
/** The toolbar owns the sole page title inside the persistent dashboard shell. */
export function ShellTitleProvider({ children }: { children: React.ReactNode }) {
  return <ShellTitleContext.Provider value>{children}</ShellTitleContext.Provider>;
}

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
  density = "regular",
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  eyebrow?: string;
  density?: "regular" | "compact";
  className?: string;
}) {
  const shellOwnsTitle = useContext(ShellTitleContext);
  if (shellOwnsTitle && !description && !eyebrow && !action) return null;
  return (
    <div
      data-page-header
      className={cn(
        "mac-page-header flex flex-col gap-3 border-b border-border xl:flex-row xl:items-end xl:justify-between xl:gap-4",
        density === "compact" ? "mb-4 pb-3" : "mb-6 pb-4",
        className,
      )}
    >
      {(!shellOwnsTitle || description || eyebrow) && <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand">{eyebrow}</p>}
        {!shellOwnsTitle && <h1 className="text-2xl font-semibold leading-tight tracking-[-0.025em] text-foreground">
          {title}
        </h1>}
        {description && (
          <p className="mt-1 text-sm text-foreground-muted">{description}</p>
        )}
      </div>}
      {action && <div className="min-w-0 max-w-full">{action}</div>}
    </div>
  );
}

export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wider text-foreground-muted",
        className,
      )}
    >
      {children}
    </p>
  );
}
