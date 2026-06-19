/**
 * Deterministic, theme-safe tag color. The same string always yields the same
 * hue; the lightness/saturation are tuned so the chip reads well on both the
 * light and dark surface tokens.
 *
 * Returns inline-style values rather than Tailwind classes because Tailwind
 * can't bind arbitrary `hsl(N ...)` at build time.
 */
export function tagColor(tag: string): {
  bg: string;
  text: string;
  border: string;
} {
  // FNV-1a-ish hash — fast, no deps, stable. Modulo 360 gives a hue.
  let h = 2166136261;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  const hue = h % 360;

  // color-mix lets one declaration cover both themes: the chip background
  // mixes the hue into the dashboard's surface color, so it never fights
  // light/dark mode. Text + border stay vivid for legibility.
  return {
    bg: `color-mix(in oklch, hsl(${hue} 70% 55%) 14%, var(--surface))`,
    // Blend the hue toward the foreground so the chip text keeps its colour
    // identity while clearing WCAG AA on the tinted background in both themes
    // (foreground flips light/dark).
    text: `color-mix(in oklch, hsl(${hue} 70% 45%) 42%, var(--foreground))`,
    border: `color-mix(in oklch, hsl(${hue} 70% 55%) 35%, var(--border))`,
  };
}
