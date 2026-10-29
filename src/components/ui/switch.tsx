"use client";

import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

/** ShadCN-style Switch (Radix) — the shared on/off toggle, styled from the
 * design tokens. The 36×20 track stays compact inside a 44px mobile / 32px desktop target. */
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    className={cn(
      "group/switch peer inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md focus-ring disabled:cursor-not-allowed disabled:opacity-50 md:h-8 md:w-9",
      className,
    )}
    {...props}
  >
    <span aria-hidden="true" className="pointer-events-none inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors group-data-[state=checked]/switch:border-primary group-data-[state=checked]/switch:bg-primary group-data-[state=unchecked]/switch:border-border group-data-[state=unchecked]/switch:bg-surface-muted">
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-surface shadow-soft ring-0 transition-transform",
          "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5",
        )}
      />
    </span>
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;
