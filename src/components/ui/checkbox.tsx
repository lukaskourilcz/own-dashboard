"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/** ShadCN-style Checkbox (Radix) — the shared checkbox, styled from the design
 * tokens, with a compact mark inside a 44px mobile / 32px desktop target. Use `checked` + `onCheckedChange`; pass `aria-label` for icon-only use. */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "group/checkbox peer inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-50 md:size-8",
      className,
    )}
    {...props}
  >
    <span aria-hidden="true" className="pointer-events-none flex size-4 items-center justify-center rounded border border-border-strong transition-colors group-hover/checkbox:border-foreground/40 group-data-[state=checked]/checkbox:border-primary group-data-[state=checked]/checkbox:bg-primary group-data-[state=checked]/checkbox:text-primary-foreground group-data-[state=indeterminate]/checkbox:border-primary group-data-[state=indeterminate]/checkbox:bg-primary group-data-[state=indeterminate]/checkbox:text-primary-foreground">
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="h-3 w-3 group-data-[state=indeterminate]/checkbox:hidden" strokeWidth={3} />
        <Minus className="hidden h-3 w-3 group-data-[state=indeterminate]/checkbox:block" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </span>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
