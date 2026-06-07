import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground transition-all duration-150 ease-out",
      "placeholder:text-foreground-subtle",
      "hover:border-border-strong",
      "focus-visible:outline-none focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "tabular",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
