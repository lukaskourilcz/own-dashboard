"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

/** Share the same bounded value between the visual indicator and Radix's
 * accessible progress state. Null/omitted values remain indeterminate. */
export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    indicatorClassName?: string;
  }
>(({ className, indicatorClassName, value, max = 100, ...props }, ref) => {
  const maximum = Number.isFinite(max) && max > 0 ? max : 100;
  const current = typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(0, value)) : null;
  return (
  <ProgressPrimitive.Root
    ref={ref}
    value={current}
    max={maximum}
    className={cn(
      "relative h-1 w-full overflow-hidden rounded-full bg-border",
      className,
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn(
        "h-full w-full flex-1 rounded-full bg-foreground/70 transition-transform duration-300",
        indicatorClassName,
      )}
      style={{ transform: `translateX(-${100 - ((current ?? 0) / maximum) * 100}%)` }}
    />
  </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;
