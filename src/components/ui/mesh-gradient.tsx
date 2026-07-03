import { cn } from "@/lib/utils";

/**
 * Static, dependency-free mesh gradient — layered soft radial blobs in the
 * app's accent hues. Purely decorative (aria-hidden) and pointer-transparent,
 * so it drops behind content as an `absolute inset-0` layer. Dimmer in dark
 * mode. No canvas, no runtime library — it's just CSS.
 */
export function MeshGradient({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden opacity-70 dark:opacity-40",
        className,
      )}
      style={{
        background: [
          "radial-gradient(42% 55% at 12% 18%, rgba(99, 102, 241, 0.28), transparent 60%)",
          "radial-gradient(38% 48% at 88% 12%, rgba(236, 72, 153, 0.22), transparent 60%)",
          "radial-gradient(46% 58% at 78% 88%, rgba(20, 184, 166, 0.20), transparent 62%)",
          "radial-gradient(40% 52% at 22% 92%, rgba(59, 130, 246, 0.18), transparent 60%)",
        ].join(", "),
      }}
    />
  );
}
