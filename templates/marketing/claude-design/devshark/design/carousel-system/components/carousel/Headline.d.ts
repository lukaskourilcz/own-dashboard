import * as React from 'react';
export interface HeadlineProps {
  /** default 104 px (three-line), short 112 px (one–two lines), hero 152 px (statement slides), cover 80 px. */
  size?: 'default' | 'short' | 'hero' | 'cover';
  as?: 'h1' | 'h2' | 'div';
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Headline(props: HeadlineProps): JSX.Element;
export interface BigNumberProps { value: string; unit?: string; style?: React.CSSProperties; }
export function BigNumber(props: BigNumberProps): JSX.Element;
export interface StatementProps { style?: React.CSSProperties; children?: React.ReactNode; }
export function Statement(props: StatementProps): JSX.Element;
export function Accent(props: { children?: React.ReactNode }): JSX.Element;
export interface FooterProps { align?: 'left' | 'right'; /** Brand ink instead of secondary text — on the cover, over the fin. */ ink?: boolean; children?: React.ReactNode; }
export function Footer(props: FooterProps): JSX.Element;
export function Logo(props: { width?: string | number }): JSX.Element;
