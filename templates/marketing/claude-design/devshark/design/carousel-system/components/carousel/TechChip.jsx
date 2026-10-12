import React from 'react';

const TECH = {
  html5: ['HTML', 'var(--tint-html)'], css3: ['CSS', 'var(--tint-css)'], javascript: ['JavaScript', 'var(--tint-javascript)'],
  typescript: ['TypeScript', 'var(--tint-typescript)'], react: ['React', 'var(--tint-react)'], nextjs: ['Next.js', 'var(--tint-nextjs)'], nodejs: ['Node.js', 'var(--tint-nodejs)'],
};

/** A topic chip with its official devicon logo on the logo's brand tint. Plain chips (no logo) take the chip fill and a hairline. */
export function TechChip({ tech, assetBase = 'assets/', children }) {
  const t = TECH[tech];
  if (!t) {
    return <span style={{ padding: '14px 28px', background: 'var(--chip-bg)', border: '1px solid var(--panel-hairline)', borderRadius: 'var(--radius-chip)', font: 'var(--weight-body-strong) 42px/1 var(--font-body)', color: 'var(--panel-text)' }}>{children}</span>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 18, padding: 'var(--chip-pad)', background: t[1], color: 'var(--brand-ink)', borderRadius: 'var(--radius-chip)', font: 'var(--weight-body-strong) var(--type-chip)/1 var(--font-body)' }}>
      <img src={`${assetBase}tech-${tech}.svg`} alt="" style={{ width: 'var(--chip-logo)', height: 'var(--chip-logo)', display: 'block' }} />
      {children ?? t[0]}
    </span>
  );
}

/** Wrapping row of chips. */
export function ChipRow({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--chip-gap)' }}>{children}</div>;
}
