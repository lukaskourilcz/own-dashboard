import * as React from 'react';
export interface KickerProps {
  /** Which of the eight waterline tiles. Step by three between neighbouring slides: 1, 4, 7, 2, 5, 8, 3, 6. */
  wave?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  children?: React.ReactNode;
}
export function Kicker(props: KickerProps): JSX.Element;
