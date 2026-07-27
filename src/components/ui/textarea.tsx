import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[88px] w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground shadow-soft transition-all duration-150 ease-out md:min-h-[72px] md:text-[13px]",
      "placeholder:text-foreground-subtle",
      "hover:border-border-strong",
      "focus-visible:outline-none focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "resize-none",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
