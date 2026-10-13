import React from 'react';

const COLORS = { k: 'var(--code-keyword)', f: 'var(--code-function)', o: 'var(--code-operator)', n: 'var(--code-number)', c: 'var(--code-class)', s: 'var(--code-string)', m: 'var(--code-comment)' };

/**
 * The website's Prism One Dark block. Pass lines as arrays of [text, kind?] tokens (kind: k keyword, f function, o operator, n number, c class, s string, m comment).
 */
export function CodeBlock({ lines = [], style }) {
  return (
    <pre style={{ margin: '0 8px', padding: 'var(--code-pad)', borderRadius: 'var(--radius-code)', background: 'var(--code-bg)', color: 'var(--code-fg)', font: 'var(--weight-body) var(--type-code)/1.45 var(--font-mono)', whiteSpace: 'pre', ...style }}>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          {line.map((tok, j) => (typeof tok === 'string' ? tok : <span key={j} style={{ color: COLORS[tok[1]] }}>{tok[0]}</span>))}
          {i < lines.length - 1 ? '\n' : ''}
        </React.Fragment>
      ))}
    </pre>
  );
}

/** The tinted result line under the code: “✓ 25 of 25 tests passed”. */
export function TestsPassed({ children }) {
  return <div style={{ margin: '16px 8px 0', padding: '16px 28px', background: 'var(--panel-tint)', borderRadius: 'var(--radius-row)', font: 'var(--weight-body) var(--type-tests)/1.5 var(--font-mono)' }}><span style={{ color: 'var(--panel-accent)' }}>✓</span> {children}</div>;
}
