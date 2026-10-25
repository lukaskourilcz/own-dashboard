'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDict } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Keep ordinary rows compact; reveal the complete selectable title only when it actually clips. */
export function TaskTitle({ title, done = false, className }: { title: string; done?: boolean; className?: string }) {
  const t = useDict(), id = useId(), text = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false), [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = text.current;
    if (!element) return;
    const measure = () => { const line = Number.parseFloat(getComputedStyle(element).lineHeight); setClipped(Number.isFinite(line) && element.scrollHeight > line * 3 + 1); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [title]);
  return <div className={cn('min-w-0', className)}>
    <p id={id} ref={text} className={cn('break-words text-sm leading-5 [overflow-wrap:anywhere]', expanded ? '' : 'line-clamp-3', done ? 'text-foreground-subtle line-through' : 'text-foreground')}>{title}</p>
    {(clipped || expanded) && <Button variant="link" type="button" className="justify-start px-0 text-xs" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? t.todos.hideTaskText : t.todos.showTaskText}</Button>}
  </div>;
}
