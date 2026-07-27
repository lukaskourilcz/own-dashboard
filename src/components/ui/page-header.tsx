import { cn } from "@/lib/utils";

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
  return (
    <div
      data-page-header
      className={cn(
        "mac-page-header flex flex-col gap-3 border-b border-border sm:flex-row sm:items-end sm:justify-between sm:gap-4",
        density === "compact" ? "mb-4 pb-3" : "mb-6 pb-4",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand">{eyebrow}</p>}
        <h1 className="text-xl font-semibold tracking-[-0.018em] text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-foreground-muted">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
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
