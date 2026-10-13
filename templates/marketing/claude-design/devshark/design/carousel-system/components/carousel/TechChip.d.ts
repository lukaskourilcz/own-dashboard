import * as React from 'react';
export interface TechChipProps {
  /** One of the seven technologies with an official logo; omit for a plain text chip. */
  tech?: 'html5' | 'css3' | 'javascript' | 'typescript' | 'react' | 'nextjs' | 'nodejs';
  /** Path prefix to the tech-*.svg files. */
  assetBase?: string;
  children?: React.ReactNode;
}
export function TechChip(props: TechChipProps): JSX.Element;
export function ChipRow(props: { children?: React.ReactNode }): JSX.Element;
