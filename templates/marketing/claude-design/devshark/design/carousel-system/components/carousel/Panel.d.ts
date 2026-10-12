import * as React from 'react';
export interface PanelProps {
  /** Fill down to the bottom margin (key-element slides) or size to content (leave water for the fin). */
  fill?: boolean;
  /** Rows layout: 40px 20px padding so tinted rows stop 28 px inside the edge. */
  rows?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Panel(props: PanelProps): JSX.Element;
export interface PanelRowProps { marker?: '✓' | string; /** Accent tint behind the row — one per slide at most. */ highlighted?: boolean; children?: React.ReactNode; }
export function PanelRow(props: PanelRowProps): JSX.Element;
export interface BodyProps { size?: string; strong?: boolean; muted?: boolean; style?: React.CSSProperties; children?: React.ReactNode; }
export function Body(props: BodyProps): JSX.Element;
export function TintRow(props: { children?: React.ReactNode }): JSX.Element;
