"use client";

import * as React from "react";
import * as RT from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => (
  <RT.Provider delayDuration={300} skipDelayDuration={200}>
    {children}
  </RT.Provider>
);

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            "z-50 select-none rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-foreground shadow-elevated",
            "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=delayed-open]:zoom-in-95",
            className,
          )}
        >
          {content}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
