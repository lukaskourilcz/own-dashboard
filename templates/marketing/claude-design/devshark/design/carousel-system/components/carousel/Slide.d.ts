import * as React from 'react';
/**
 * @startingPoint section="Carousel" subtitle="One 1080 × 1350 slide with fin, grain and content box" viewport="1080x1350"
 */
export interface SlideProps {
  /** Background theme: pale paper, ink, or the one green slide. */
  theme?: 'light' | 'dark' | 'green';
  /** Corner fin, 48 px at (48, 48). Off by default in the current carousels. */
  fin?: boolean;
  /** A kit fin riding the bottom edge in a second shade. Only where the water below the content is open. */
  bigFin?: 'big' | 'small' | 'huge' | 'tucked' | null;
  /** Paper grain overlay. */
  grain?: boolean;
  /** data-screen-label for comments/export. */
  label?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Slide(props: SlideProps): JSX.Element;
