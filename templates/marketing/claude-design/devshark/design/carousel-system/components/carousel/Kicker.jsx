import React from 'react';

/** Section label in the accent colour with the waterline underneath, exactly as long as the label. */
export function Kicker({ wave = 1, children }) {
  const m = `var(--wave-${wave}) repeat-x left center / var(--wave-tile)`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'flex-start', gap: 'var(--wave-gap)', font: 'var(--weight-kicker) var(--type-kicker)/1 var(--font-display)', letterSpacing: 'var(--tracking-kicker)', textTransform: 'uppercase', color: 'var(--accent)' }}>
      <span>{children}</span>
      <div aria-hidden style={{ height: 'var(--wave-h)', width: '100%', flex: 'none', background: 'var(--accent)', WebkitMask: m, mask: m }} />
    </div>
  );
}
