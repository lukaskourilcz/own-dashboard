import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface text-foreground shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 px-4 pt-4 pb-2.5 sm:px-[18px] sm:pt-4 sm:pb-3",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-card-title
      className={cn(
        "mac-card-title flex items-center gap-2 text-sm font-bold text-foreground tracking-[-0.01em] [&>svg]:size-[13px] [&>svg]:shrink-0 [&>svg]:rounded-md [&>svg]:bg-[var(--section-accent,var(--mac-blue))] [&>svg]:box-content [&>svg]:p-[4.5px] [&>svg]:text-white",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("text-sm text-foreground-muted", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4 sm:px-[18px] sm:pb-4", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center px-5 pb-5 pt-3 border-t border-border", className)}
      {...props}
    />
  );
}
