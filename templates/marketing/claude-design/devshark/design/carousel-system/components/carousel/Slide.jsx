import React from 'react';

const PLACES = {
  big: { width: 'var(--fin-big-w)', right: 'var(--fin-big-right)', bottom: 0 },
  small: { width: 'var(--fin-small-w)', left: 'var(--fin-small-left)', bottom: 0 },
  huge: { width: 'var(--fin-huge-w)', right: 'var(--fin-huge-right)', bottom: 'var(--fin-huge-bottom)' },
  tucked: { width: 'var(--fin-tucked-w)', left: 'var(--fin-tucked-left)', bottom: 0 },
};

/** A 1080 × 1350 carousel slide: themed background with paper grain, an optional surfacing fin (corner fin off by default), and the content box. */
export function Slide({ theme = 'light', fin = false, bigFin = null, grain = true, label, style, children }) {
  const place = bigFin && PLACES[bigFin];
  return (
    <div data-theme={theme} data-screen-label={label} style={{ position: 'relative', width: 'var(--slide-w)', height: 'var(--slide-h)', flex: 'none', overflow: 'hidden', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-body)', ...style }}>
      {grain && <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'var(--grain)' }} />}
      {place && <div aria-hidden style={{ position: 'absolute', aspectRatio: '19.2 / 15.9', background: 'var(--fin-big) center / contain no-repeat', ...place }} />}
      {fin && <div aria-hidden style={{ position: 'absolute', left: 'var(--fin-inset)', top: 'var(--fin-inset)', width: 'var(--fin-size)', aspectRatio: '19.2 / 15.9', background: 'var(--fin-corner) center / contain no-repeat' }} />}
      <div style={{ position: 'absolute', left: 'var(--slide-margin)', right: 'var(--slide-margin)', top: 'var(--content-top)', bottom: 'var(--slide-margin)', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}
