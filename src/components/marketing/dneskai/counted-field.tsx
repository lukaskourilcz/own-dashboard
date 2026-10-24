'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { characterCount } from '@/lib/marketing/dneskai-deck-editor';
import { cn } from '@/lib/utils';

/** A labelled text field with a character counter tied to it; past the limit the counter says by how much. */
export function CountedField({ id, label, value, max, multiline, rows = 3, help, lang, count: countValue = value => characterCount(value.trim()), onChange }: {
  id: string; label: string; value: string; max: number; multiline?: boolean; rows?: number; help?: string; lang: 'en' | 'cs'; count?: (value: string) => number; onChange: (value: string) => void;
}) {
  const t = dneskaiWorkspace[lang];
  const count = countValue(value);
  const over = count - max;
  const described = [`${id}-count`, help ? `${id}-help` : ''].filter(Boolean).join(' ');
  const props = { id, value, 'aria-describedby': described, 'aria-invalid': over > 0 || undefined, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    className: cn(over > 0 && 'border-risk') };
  return <div className="min-w-0 space-y-1" data-testid={`dneskai-field-${id}`}>
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={id} className="text-xs font-medium text-foreground-muted">{label}</label>
      <span id={`${id}-count`} className={cn('text-[11px] tabular', over > 0 ? 'font-semibold text-risk' : 'text-foreground-muted')}>{t.counter(count, max)}{over > 0 ? ` · ${t.over(over)}` : ''}</span>
    </div>
    {multiline ? <Textarea rows={rows} {...props} className={cn('min-h-0 md:min-h-0', props.className)} /> : <Input {...props} />}
    {help && <p id={`${id}-help`} className="text-xs text-foreground-muted">{help}</p>}
  </div>;
}
