import { cn } from "@/lib/utils";

/**
 * Restrained hero backdrop — a soft warm wash from the top edge over a faint
 * dot grid that fades out before it reaches the content. Deliberately
 * monochrome and low-contrast so it reads as an intentional texture in the
 * app's neutral/stone palette rather than a generic rainbow "mesh". Purely
 * decorative (aria-hidden), pointer-transparent, and pure CSS — no canvas, no
 * runtime library. Dimmer in dark mode.
 */
export function MeshGradient({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {/* Warm highlight, as if lit from just above the card. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(115% 80% at 50% -25%, rgba(120, 113, 108, 0.10), transparent 62%)",
        }}
      />
      {/* Fine dot grid — the "engineered" texture — masked to fade downward. */}
      <div
        className="absolute inset-0 opacity-60 dark:opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(var(--border-strong) 0.5px, transparent 0.6px)",
          backgroundSize: "15px 15px",
          maskImage:
            "linear-gradient(to bottom right, black, transparent 65%)",
          WebkitMaskImage:
            "linear-gradient(to bottom right, black, transparent 65%)",
        }}
      />
    </div>
  );
}
