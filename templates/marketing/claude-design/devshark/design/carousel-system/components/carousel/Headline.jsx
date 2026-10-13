import React from 'react';

const SIZES = {
  default: { fontSize: 'var(--type-headline)', lineHeight: 'var(--leading-display)', letterSpacing: 'var(--tracking-display)' },
  short: { fontSize: 'var(--type-headline-short)', lineHeight: 'var(--leading-display)', letterSpacing: 'var(--tracking-display)' },
  hero: { fontSize: 'var(--type-headline-hero)', lineHeight: 'var(--leading-hero)', letterSpacing: 'var(--tracking-hero)' },
  cover: { fontSize: 'var(--type-cover)', lineHeight: 'var(--leading-display)', letterSpacing: 'var(--tracking-display)' },
};

/** Manrope 800 headline in one of the four slide sizes. */
export function Headline({ size = 'default', as = 'h1', style, children }) {
  const Tag = as;
  return <Tag style={{ margin: 'var(--gap-kicker-headline) 0 0', fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-display)', textWrap: size === 'hero' ? 'balance' : 'pretty', ...SIZES[size], ...style }}>{children}</Tag>;
}

/** A very large number with its unit on the baseline: €1.80 a month, 55% off. */
export function BigNumber({ value, unit, style }) {
  return (
    <h1 style={{ margin: 'var(--gap-kicker-headline) 0 0', display: 'flex', alignItems: 'baseline', gap: 20, flexWrap: 'wrap', fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-display)', fontSize: 'var(--type-number-unit)', lineHeight: 1, letterSpacing: 'var(--tracking-display)', ...style }}>
      <span style={{ fontSize: 'var(--type-number)', lineHeight: 0.9, letterSpacing: 'var(--tracking-number)' }}>{value}</span>
      {unit && <span>{unit}</span>}
    </h1>
  );
}

/** Cover statement: the same face and size as the cover headline, flush with it. Wrap key phrases in <Accent>. */
export function Statement({ style, children }) {
  return <p style={{ margin: 'var(--gap-cover-statement) 0 0', font: 'var(--weight-display) var(--type-cover)/1.05 var(--font-display)', letterSpacing: 'var(--tracking-display)', textWrap: 'pretty', ...style }}>{children}</p>;
}

/** Accent-coloured phrase inside a headline or statement. */
export function Accent({ children }) {
  return <span style={{ color: 'var(--accent)' }}>{children}</span>;
}

/** Small Inter 500 line on the bottom margin: “Swipe →”, dates. Ink on the cover so it reads over the fin. */
export function Footer({ align = 'left', ink = false, children }) {
  return <div style={{ marginTop: 'auto', alignSelf: align === 'right' ? 'flex-end' : 'flex-start', font: 'var(--weight-body-strong) var(--type-footer)/1 var(--font-body)', color: ink ? 'var(--brand-ink)' : 'var(--text-2)' }}>{children}</div>;
}

/** Horizontal logo, 400 px, in the colour the background asks for. Closing slide only. */
export function Logo({ width = 'var(--logo-w)' }) {
  return <div role="img" aria-label="devShark" style={{ width, aspectRatio: '602.571 / 95.764', background: 'var(--logo-horizontal) left / contain no-repeat' }} />;
}
