import { cn } from "@/lib/utils";

/**
 * Name-independent connected-work mark. It is intentionally deterministic and
 * monochrome-capable; future reviewed exploration may refine, not replace,
 * this component's accessible placement contract.
 */
export function BrandMark({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      className={cn("brand-mark relative inline-flex h-7 w-7 shrink-0 rounded-md bg-primary text-primary-foreground", className)}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
    >
      <span className="absolute left-[27%] top-[25%] h-[50%] w-[47%] rounded-[2px] border-b border-l border-current opacity-80" />
      <span className="absolute left-[20%] top-[18%] h-[20%] w-[20%] rounded-[2px] bg-current" />
      <span className="absolute right-[18%] top-[18%] h-[20%] w-[20%] rounded-[2px] border border-current bg-primary" />
      <span className="absolute bottom-[17%] right-[18%] h-[20%] w-[20%] rounded-full bg-current" />
    </span>
  );
}
