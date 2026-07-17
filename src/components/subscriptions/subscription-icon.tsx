import { brandFor } from "@/lib/subscription-brands";
import { cn } from "@/lib/utils";

/**
 * Brand mark for a subscription, rendered as a rounded tile — the app-icon
 * look. Known services get their real logo (white glyph on the brand colour);
 * everything else gets an on-brand or hashed monogram so every row still reads
 * as a distinct, coloured icon rather than a generic placeholder.
 */
export function SubscriptionIcon({
  name,
  size = 32,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const brand = brandFor(name);
  const bg = brand?.color ?? hashedColor(name);
  const letter = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[22%] ring-1 ring-inset ring-black/10 dark:ring-white/15",
        className,
      )}
      style={{ width: size, height: size, background: bg }}
    >
      {brand?.path ? (
        <svg
          viewBox="0 0 24 24"
          width={size * 0.56}
          height={size * 0.56}
          fill="#fff"
          role="img"
        >
          <path d={brand.path} />
        </svg>
      ) : (
        <span
          className="font-semibold leading-none text-white"
          style={{ fontSize: size * 0.44 }}
        >
          {letter}
        </span>
      )}
    </span>
  );
}

/** Deterministic, pleasant tile colour for an unknown service name. */
function hashedColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 52% 42%)`;
}
