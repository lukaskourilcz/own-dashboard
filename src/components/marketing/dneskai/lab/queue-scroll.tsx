'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One day of the Lab queue (owner request, 9 November 2026): at most about five cards show at once and the rest
 * scroll inside the panel, at every width. While more cards wait below, the bottom edge fades out (a mask, so the
 * cards keep their own tints). The region takes keyboard focus only while it actually scrolls, so arrow keys and
 * Page Up/Down move it; its name says which day it lists.
 */
export function DneskaiQueueScroll({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ scrolls: false, more: false });
  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const scrolls = element.scrollHeight > element.clientHeight + 1;
    const more = scrolls && element.scrollTop + element.clientHeight < element.scrollHeight - 1;
    setState((current) => current.scrolls === scrolls && current.more === more ? current : { scrolls, more });
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, children]);
  return <div ref={ref} role="region" aria-label={label} tabIndex={state.scrolls ? 0 : undefined} onScroll={measure}
    data-testid="dneskai-lab-queue-scroll" data-scrolls={state.scrolls ? 'true' : 'false'} data-more={state.more ? 'true' : 'false'}
    className={cn('max-h-[29.5rem] space-y-1 overflow-y-auto overscroll-y-contain rounded-md focus-ring', state.more && '[mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]')}>
    {children}
  </div>;
}
