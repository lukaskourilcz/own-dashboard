import React from 'react';

/** The surface card that holds a slide's key element. Reads --panel-* so it turns white-with-ink on the green slide. */
export function Panel({ fill = true, rows = false, style, children }) {
  return (
    <div style={{ marginTop: 'var(--gap-headline-panel)', flex: fill ? 1 : 'none', background: 'var(--panel-bg)', color: 'var(--panel-text)', border: '1px solid var(--panel-hairline)', borderRadius: 'var(--radius-panel)', padding: rows ? 'var(--panel-pad-rows)' : 'var(--panel-pad)', display: 'flex', flexDirection: 'column', gap: rows ? 4 : 0, boxSizing: 'border-box', ...style }}>
      {children}
    </div>
  );
}

/** One row inside a rows Panel: a numbered step or a check, optionally on the accent tint. */
export function PanelRow({ marker = '✓', highlighted = false, children }) {
  const check = marker === '✓';
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', padding: 'var(--row-pad)', background: highlighted ? 'var(--panel-tint)' : 'transparent', borderRadius: 'var(--radius-row)' }}>
      <span style={{ flex: 'none', width: check ? 52 : 64, font: `var(--weight-kicker) ${check ? '44px' : 'var(--type-row-marker)'}/1 var(--font-display)`, color: 'var(--panel-accent)' }}>{marker}</span>
      <span style={{ font: 'var(--weight-body) var(--type-body)/var(--leading-row) var(--font-body)' }}>{children}</span>
    </div>
  );
}

/** Body copy inside or outside a panel. */
export function Body({ size = 'var(--type-body)', strong = false, muted = false, style, children }) {
  return <p style={{ margin: 0, font: `${strong ? 'var(--weight-body-strong)' : 'var(--weight-body)'} ${size}/var(--leading-body) var(--font-body)`, color: muted ? 'var(--panel-text-2)' : 'inherit', textWrap: 'pretty', ...style }}>{children}</p>;
}

/** A tinted single line at the foot of a panel: “Offer ends 2 Nov 2026”. */
export function TintRow({ children }) {
  return <div style={{ marginTop: 'auto', padding: '22px 28px', background: 'var(--panel-tint)', borderRadius: 'var(--radius-row)', font: 'var(--weight-body-strong) var(--type-footer)/1 var(--font-body)' }}>{children}</div>;
}
