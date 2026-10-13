import * as React from 'react';
export type CodeToken = string | [text: string, kind: 'k' | 'f' | 'o' | 'n' | 'c' | 's' | 'm'];
export interface CodeBlockProps {
  /** One array per line; tokens are plain strings or [text, kind]. */
  lines: CodeToken[][];
  style?: React.CSSProperties;
}
export function CodeBlock(props: CodeBlockProps): JSX.Element;
export function TestsPassed(props: { children?: React.ReactNode }): JSX.Element;
